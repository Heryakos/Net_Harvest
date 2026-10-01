import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Page, BrowserContext } from 'playwright';

export class CambridgeReaderEngine {
  page: Page;
  browser: any;
  selector: string;

  constructor(page: Page) {
    this.page = page;          // the LIVE logged-in page
    this.browser = page.context().browser();
    this.selector = '#readium-right-content';
  }

  /* ============================================================
   * A. VISIBLE IFRAME DISCOVERY
   * ========================================================== */
  async listVisibleIframes() {
    let frameToEvaluate = this.page.mainFrame();
    
    let el = await this.page.$(this.selector);
    if (!el) {
      for (const frame of this.page.frames()) {
        const frameEl = await frame.$(this.selector);
        if (frameEl) {
          frameToEvaluate = frame;
          break;
        }
      }
    }

    return frameToEvaluate.evaluate((sel) => {
      const root = document.querySelector(sel) || document.body;
      if (!document.querySelector(sel)) {
         console.warn(`Selector not found: ${sel}, falling back to document.body`);
      }
      return [...root.querySelectorAll('iframe')]
        .map(f => {
          const r = f.getBoundingClientRect();
          const cs = getComputedStyle(f);
          const onScreen = r.width > 0 && r.height > 0 &&
            r.bottom > 0 && r.right > 0 &&
            r.top < innerHeight && r.left < innerWidth;
          return {
            src: f.src,
            id: f.id,
            title: f.getAttribute('aria-label') || f.title || '',
            visible: cs.opacity !== '0' && onScreen,   // kills preloaded neighbors
          };
        })
        .filter(f => f.visible);
    }, this.selector);
  }

  /* ============================================================
   * IN-PAGE FETCH HELPERS
   * ========================================================== */
  async fetchText(url: string) {
    const res = await this.page.context().request.get(url);
    if (!res.ok()) throw new Error(`HTTP ${res.status()} for ${url}`);
    return await res.text();
  }

  async fetchBuf(url: string) {
    const res = await this.page.context().request.get(url);
    if (!res.ok()) throw new Error(`HTTP ${res.status()} for ${url}`);
    return Buffer.from(await res.body());
  }

  /* ============================================================
   * B. SELF-CONTAINED PAGE HARVEST
   * ========================================================== */
  async harvestPage(xhtmlUrl: string, outDir: string) {
    fs.mkdirSync(outDir, { recursive: true });
    const assetDir = path.join(outDir, 'assets');
    fs.mkdirSync(assetDir, { recursive: true });

    const assetMap = new Map();   // absoluteUrl -> local filename
    
    // We cannot easily do recursion inside the evaluate without making it complex,
    // so we handle saveAsset locally by fetching buffer via page.evaluate
    const saveAsset = async (rawUrl: string, parentUrl: string): Promise<string> => {
      const abs = new URL(rawUrl, parentUrl).href.split('#')[0]!;
      if (assetMap.has(abs)) return assetMap.get(abs) as string;
      const buf = await this.fetchBuf(abs);
      const fname = `asset-${String(assetMap.size + 1).padStart(3, '0')}.${this.guessExt(abs, buf)}`;
      fs.writeFileSync(path.join(assetDir, fname), buf);
      assetMap.set(abs, fname);

      if (fname.endsWith('.css')) {
        let css = buf.toString('utf8');
        const refs = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map(m => m[1]!)
          .concat([...css.matchAll(/@import\s+["']([^"']+)["']/g)].map(m => m[1]!));
        for (const ref of refs) {
          if (!ref || ref.startsWith('data:')) continue;
          const local = await saveAsset(ref, abs);   
          css = css.split(ref).join(`assets/${local}`);
        }
        fs.writeFileSync(path.join(assetDir, fname), css);
      }
      return fname;
    };

    const html = await this.fetchText(xhtmlUrl);
    const refs = [
      ...html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi),   // CSS
      ...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi),     // images
      ...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi),  // scripts
      ...html.matchAll(/<image[^>]+xlink:href=["']([^"']+)["']/gi), // SVG-embedded
      ...html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g),   // inline styles
    ].map(m => m[1]!).filter((u): u is string => !!u && !u.startsWith('data:'));

    const localNames: Record<string, string> = {};
    for (const ref of refs) {
      try { localNames[ref] = await saveAsset(ref, xhtmlUrl); }
      catch (e: any) { console.warn('[skip]', ref, e.message); }
    }

    let out = html;
    for (const [ref, local] of Object.entries(localNames))
      out = out.split(ref).join(`assets/${local}`);
    
    let pageName = path.basename(new URL(xhtmlUrl).pathname); 
    if (!pageName || pageName === '/') pageName = 'index.xhtml';
    fs.writeFileSync(path.join(outDir, pageName), out);

    return { page: pageName, assets: assetMap.size, outDir };
  }

  /* ============================================================
   * C. RENDERED COMPOSITE SCREENSHOT
   * ========================================================== */
  async renderAndScreenshot(xhtmlUrl: string, outFile: string) {
    const ctx = this.page.context();
    const p = await ctx.newPage();
    try {
      await p.goto(xhtmlUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await p.waitForTimeout(500); 
      await p.screenshot({ path: outFile, fullPage: true });
    } finally {
      await p.close();
    }
    return outFile;
  }

  /* ============================================================
   * MASTER FLOW
   * ========================================================== */
  async captureVisibleSpread(baseOutDir: string, onProgress?: (msg: string) => void) {
    if (onProgress) onProgress('Listing visible iframes...');
    const frames = await this.listVisibleIframes();
    if (!frames.length) throw new Error('No visible pages inside selector — is the book open?');
    if (onProgress) onProgress(`Found ${frames.length} visible pages on screen.`);

    const results = [];
    for (const f of frames) {
      if (onProgress) onProgress(`Extracting page: ${f.src}`);
      const pageNumMatch = f.src.match(/page(\d+)\.xhtml/);
      const pageNum = pageNumMatch ? pageNumMatch[1] : String(results.length + 1);
      const outDir = path.join(baseOutDir, `page-${pageNum}`);
      fs.mkdirSync(outDir, { recursive: true });

      if (onProgress) onProgress(`Harvesting DOM and assets for page-${pageNum}...`);
      const pkg = await this.harvestPage(f.src, outDir);
      
      if (onProgress) onProgress(`Baking full composite screenshot for page-${pageNum}...`);
      const png = await this.renderAndScreenshot(f.src, path.join(outDir, `page-${pageNum}.png`));
      
      results.push({ ...pkg, screenshot: png, title: f.title });
    }
    return results;
  }

  /* ============================================================
   * SINGLE IMAGE TEST (MVP)
   * ========================================================== */
  async captureSingleImage(outDir: string, onProgress?: (msg: string) => void) {
    if (onProgress) onProgress(`[single-test] 1/5 Looking for selector "${this.selector}"...`);
    let el = await this.page.$(this.selector);
    
    if (!el) {
      if (onProgress) onProgress(`[single-test] Selector not in main frame, searching all ${this.page.frames().length} iframes...`);
      for (const frame of this.page.frames()) {
        const frameEl = await frame.$(this.selector);
        if (frameEl) {
          el = frameEl;
          if (onProgress) onProgress(`[single-test] ✅ Found selector inside an iframe! (${frame.url()})`);
          break;
        }
      }
    }

    let buf: Buffer;
    let assetsCount = 0;

    if (el) {
      const box = await el.boundingBox();
      if (onProgress) onProgress(`[single-test] ✅ Found. Size: ${box ? Math.round(box.width) : 0}x${box ? Math.round(box.height) : 0}px`);
      
      const frameUrl = await el.evaluate(() => window.location.href);
      if (onProgress) onProgress(`[single-test] 2/5 Harvesting DOM/Assets for: ${frameUrl}`);
      try {
        const pkg = await this.harvestPage(frameUrl, outDir);
        assetsCount = pkg.assets + 1; // +1 for the HTML file itself
        if (onProgress) onProgress(`[single-test] ✅ Successfully harvested assets!`);
      } catch(e: any) {
         if (onProgress) onProgress(`[single-test] ❌ Harvest failed: ${e.message}`);
      }

      if (onProgress) onProgress('[single-test] 3/5 Taking element screenshot as bonus...');
      if (box) {
        // Workaround for Playwright nested iframe element.screenshot() bugs: 
        // take a full page screenshot and clip it using the element's bounding box
        buf = await this.page.screenshot({ type: 'png', clip: box });
      } else {
        buf = await el.screenshot({ type: 'png' });
      }
    } else {
      if (onProgress) onProgress(`[single-test] ❌ FAIL: selector not found on page. Falling back to viewport screenshot.`);
      if (onProgress) onProgress('[single-test] 2/5 Taking viewport screenshot...');
      buf = await this.page.screenshot({ type: 'png' });
    }
    
    if (onProgress) onProgress(`[single-test] ✅ Captured ${buf.length} bytes`);

    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(outDir, { recursive: true });
    const pngPath = path.join(outDir, 'single-capture.png');
    fs.writeFileSync(pngPath, buf);
    if (onProgress) onProgress(`[single-test] 3/5 Saved → ${pngPath}`);

    if (onProgress) onProgress('[single-test] 4/5 Zipped via server logic.');
    return [{ page: 'single-capture.png', assets: assetsCount, outDir }];
  }

  /* ============================================================
   * AUTO-FLIP BULK CAPTURE
   * ========================================================== */
  async captureAutoFlip(baseOutDir: string, maxPages: number, nextButtonSelector: string, onProgress?: (msg: string) => void) {
    const results = [];
    const fs = require('fs');
    const path = require('path');
    
    await this.page.evaluate(() => window.focus()).catch(()=>{});

    for (let i = 1; i <= maxPages; i++) {
      if (onProgress) onProgress(`[auto-flip] Capturing spread ${i}/${maxPages}...`);
      
      const spreadDir = path.join(baseOutDir, `spread-${i}`);
      fs.mkdirSync(spreadDir, { recursive: true });
      
      let el = await this.page.$(this.selector);
      if (!el) {
        for (const frame of this.page.frames()) {
          const frameEl = await frame.$(this.selector);
          if (frameEl) {
            el = frameEl;
            break;
          }
        }
      }
      
      if (!el) {
        if (onProgress) onProgress(`[auto-flip] ⚠️ Target selector not found on spread ${i}. Stopping.`);
        break;
      }

      const frameUrl = await el.evaluate(() => window.location.href);
      if (onProgress) onProgress(`[auto-flip] Harvesting: ${frameUrl}`);
      try {
        const pkg = await this.harvestPage(frameUrl, spreadDir);
        results.push({ page: `spread-${i}`, assets: pkg.assets + 1, outDir: spreadDir });
      } catch (e: any) {
        if (onProgress) onProgress(`[auto-flip] ❌ Harvest failed: ${e.message}`);
        break;
      }

      if (i < maxPages) {
        if (nextButtonSelector) {
           if (onProgress) onProgress(`[auto-flip] Clicking next button: ${nextButtonSelector}`);
           let nextBtn = await this.page.$(nextButtonSelector);
           if (!nextBtn) {
             for (const frame of this.page.frames()) {
               const frameNextBtn = await frame.$(nextButtonSelector);
               if (frameNextBtn) {
                 nextBtn = frameNextBtn;
                 break;
               }
             }
           }
           if (nextBtn) {
             await nextBtn.click().catch(() => {});
           } else {
             if (onProgress) onProgress(`[auto-flip] ⚠️ Next button not found! Falling back to ArrowRight...`);
             await this.page.keyboard.press('ArrowRight').catch(()=>{});
           }
        } else {
          if (onProgress) onProgress(`[auto-flip] Flipping to next page (ArrowRight + Click edge)...`);
          await this.page.keyboard.press('ArrowRight').catch(()=>{});
          const viewport = this.page.viewportSize();
          if (viewport) {
             await this.page.mouse.click(viewport.width - 20, viewport.height / 2).catch(()=>{});
          }
        }
        await this.page.waitForTimeout(2500); 
      }
    }
    
    if (onProgress) onProgress(`[auto-flip] ✅ Successfully captured ${results.length} spreads!`);
    return results;
  }

  guessExt(url: string, buf: Buffer) {
    const m = url.match(/\.(png|jpe?g|webp|svg|gif|css|xhtml?|html|js|woff2?|ttf|otf|mp3|mp4)(\?|$)/i);
    if (m) return m[1]!.toLowerCase().replace('jpeg', 'jpg');
    if (buf && buf.length > 3) {
      if (buf && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
      if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
      if (buf.slice(0, 4).toString() === 'RIFF') return 'webp';
      if (buf.slice(0, 4).toString() === 'wOFF' || buf.slice(0, 4).toString() === 'OTTO') return 'woff';
    }
    return 'bin';
  }
}
