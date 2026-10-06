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
  async harvestPage(xhtmlUrl: string, outDir: string, liveHtml?: string) {
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

    const html = liveHtml || await this.fetchText(xhtmlUrl);
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
   * SMART PAGE-READY DETECTION
   * Polls until the page content has changed from previous state
   * AND all images inside the target element are fully loaded.
   * ========================================================== */
  async waitForPageReady(
    selector: string,
    maxWaitMs: number = 30000,
    onProgress?: (msg: string, current?: number, total?: number) => void
  ): Promise<void> {
    // Step 1: Take a fingerprint of the current page (image srcs + text snippet)
    const getFingerprint = async (): Promise<string> => {
      return await this.page.evaluate((sel: string) => {
        const tryInDoc = (doc: Document): string | null => {
          const el = doc.querySelector(sel);
          if (!el) return null;
          // Collect all img srcs and the first bit of text content
          const imgs = Array.from(el.querySelectorAll('img'))
            .map(img => img.src || img.getAttribute('src') || '')
            .filter(Boolean)
            .join('|');
          const iframes = Array.from(el.querySelectorAll('iframe'))
            .map(f => f.src || f.getAttribute('src') || '')
            .filter(Boolean)
            .join('|');
          const text = (el.textContent || '').trim().slice(0, 200);
          return imgs + '::' + iframes + '::' + text;
        };
        // Try main doc first
        let fp = tryInDoc(document);
        if (fp) return fp;
        // Try frames
        for (const frame of Array.from(window.frames)) {
          try {
            // @ts-ignore
            const fDoc = frame.document;
            if (fDoc) { const r = tryInDoc(fDoc); if (r) return r; }
          } catch {}
        }
        return '';
      }, selector).catch(() => '');
    };

    // Step 2: Check if all images in the element are loaded
    const areImagesLoaded = async (): Promise<boolean> => {
      return await this.page.evaluate((sel: string) => {
        const checkImagesInDoc = (doc: Document): boolean => {
          const el = doc.querySelector(sel);
          if (!el) return false;
          const imgs = Array.from(el.querySelectorAll('img'));
          if (imgs.length === 0) return true; // no images = nothing to wait for
          return imgs.every(img => img.complete && img.naturalWidth > 0);
        };
        if (checkImagesInDoc(document)) return true;
        for (const frame of Array.from(window.frames)) {
          try {
            // @ts-ignore
            const fDoc = frame.document;
            if (fDoc && checkImagesInDoc(fDoc)) return true;
          } catch {}
        }
        return false;
      }, selector).catch(() => false);
    };

    const startFingerprint = await getFingerprint();
    const deadline = Date.now() + maxWaitMs;

    // Give the animation a moment to START before we start polling
    await this.page.waitForTimeout(600);

    let contentChanged = false;
    let imagesLoaded = false;
    let polls = 0;

    while (Date.now() < deadline) {
      polls++;
      const fp = await getFingerprint();
      const imgs = await areImagesLoaded();

      if (!contentChanged && fp !== startFingerprint && fp !== '') {
        contentChanged = true;
        if (onProgress) onProgress(`[auto-flip] ✅ Page content changed (detected on poll ${polls})`);
      }

      if (contentChanged) {
        imagesLoaded = imgs;
        if (imagesLoaded) {
          if (onProgress) onProgress(`[auto-flip] ✅ All images loaded! (poll ${polls})`);
          // Small final settle time for rendering
          await this.page.waitForTimeout(300);
          return;
        }
      }

      await this.page.waitForTimeout(500);
    }

    // Fallback: timed out — screenshot anyway with a warning
    if (onProgress) onProgress(`[auto-flip] ⚠️ Timed out waiting for page (${maxWaitMs / 1000}s). Taking screenshot anyway.`);
    await this.page.waitForTimeout(500);
  }

  /* ============================================================
   * AUTO-FLIP BULK CAPTURE
   * ========================================================== */
  async captureAutoFlip(
    baseOutDir: string, 
    maxPages: number, 
    nextButtonSelector: string, 
    pdfOnlyMode: boolean, 
    isCancelled: () => boolean,
    getSkipCount: () => number,
    onProgress?: (msg: string, current?: number, total?: number) => void
  ) {
    const results = [];
    const fs = require('fs');
    const path = require('path');
    
    await this.page.evaluate(() => window.focus()).catch(()=>{});

    const displayMax = maxPages > 9000 ? 'Unlimited' : maxPages;

    for (let i = 1; i <= maxPages; i++) {
      if (isCancelled()) {
        if (onProgress) onProgress(`[auto-flip] 🛑 User cancelled capture. Stopping early at spread ${i - 1}.`, i - 1, maxPages);
        break;
      }

      const skips = getSkipCount();
      if (skips > 0) {
        if (onProgress) onProgress(`[auto-flip] ⏭️ Skipping ${skips} spread(s)...`, i, maxPages);
        for (let s = 0; s < skips; s++) {
          if (nextButtonSelector) {
            const nextBtn = await this.page.$(nextButtonSelector).catch(()=>null);
            if (nextBtn) await nextBtn.click().catch(() => {});
          } else {
            await this.page.keyboard.press('ArrowRight').catch(()=>{});
          }
          await this.page.waitForTimeout(400);
          try { await this.page.waitForLoadState('networkidle', { timeout: 2000 }); } catch (e) {}
        }
        if (onProgress) onProgress(`[auto-flip] ⏭️ Finished skipping. Resuming capture...`, i, maxPages);
      }

      if (onProgress) onProgress(`[auto-flip] Capturing spread ${i}/${displayMax}...`, i, maxPages);
      
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
        throw new Error(`Target selector "${this.selector}" was not found on the page! Make sure the book is fully loaded and you typed the correct selector.`);
      }

      let assetsCount = 0;
      try {
        if (!pdfOnlyMode) {
          const frameUrl = await el.evaluate(() => window.location.href);
          const liveHtml = await el.evaluate((node) => node.ownerDocument.documentElement.outerHTML);
          if (onProgress) onProgress(`[auto-flip] Harvesting HTML & Assets...`, i, maxPages);
          const pkg = await this.harvestPage(frameUrl, spreadDir, liveHtml);
          assetsCount = pkg.assets;
        }

        // Take screenshot
        if (onProgress) onProgress(`[auto-flip] Taking high-res screenshot of spread ${i}...`, i, maxPages);
        let buf: Buffer;
        const box = await el.boundingBox();
        const client = await this.page.context().newCDPSession(this.page);
        if (box) {
          try {
            const { data } = await client.send('Page.captureScreenshot', { 
              format: 'png', 
              clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 } 
            });
            buf = Buffer.from(data, 'base64');
          } catch (err) {
            console.log("[auto-flip] CDP screenshot failed, falling back to el.screenshot...", err);
            buf = await el.screenshot({ type: 'png', timeout: 15000 });
          }
        } else {
          buf = await el.screenshot({ type: 'png', timeout: 15000 });
        }
        await client.detach();
        const pngPath = path.join(spreadDir, `spread-${i}.png`);
        fs.writeFileSync(pngPath, buf);

        results.push({ page: `spread-${i}`, assets: assetsCount + 1, outDir: spreadDir });
      } catch (e: any) {
        throw new Error(`Harvest failed: ${e.message}`);
      }

      if (i < maxPages) {
        if (nextButtonSelector) {
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
             const isVisible = await nextBtn.isVisible();
             const isDisabledOrHidden = await nextBtn.evaluate((el: any) => {
               const style = window.getComputedStyle(el);
               return el.disabled || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none' || el.classList.contains('disabled');
             });

             if (!isVisible || isDisabledOrHidden) {
                if (onProgress) onProgress(`[auto-flip] 🛑 End of book reached! (Next button is hidden/disabled). Stopping early at spread ${i}.`, i, maxPages);
                break;
             }

             if (onProgress) onProgress(`[auto-flip] Clicking next button & waiting for page load...`, i, maxPages);
             await nextBtn.click().catch(() => {});
           } else {
             if (onProgress) onProgress(`[auto-flip] 🛑 End of book reached! (Next button not found). Stopping early at spread ${i}.`, i, maxPages);
             break;
           }
        } else {
          if (onProgress) onProgress(`[auto-flip] Flipping to next page (ArrowRight + Click edge)...`, i, maxPages);
          await this.page.keyboard.press('ArrowRight').catch(()=>{});
          const viewport = this.page.viewportSize();
          if (viewport) {
             await this.page.mouse.click(viewport.width - 20, viewport.height / 2).catch(()=>{});
          }
        }
        
        // Smart wait: poll until page content changes AND all images are loaded
        if (onProgress) onProgress(`[auto-flip] ⏳ Waiting for page ${i + 1} to fully load...`, i, maxPages);
        await this.waitForPageReady(this.selector, 30000, onProgress);
      }
    }
    
    if (onProgress) onProgress(`[auto-flip] ✅ Successfully captured ${results.length} spreads!`, results.length, maxPages);
    
    if (results.length > 0) {
      if (onProgress) onProgress(`[auto-flip] 📦 Compiling ${results.length} high-res images into PDF, DOCX, and PPTX...`, results.length, maxPages);
      try {
        const mergedDir = path.join(baseOutDir, 'merged_spread');
        fs.mkdirSync(mergedDir, { recursive: true });
        
        const { PDFDocument } = require('pdf-lib');
        const pdfDoc = await PDFDocument.create();

        const pptxgen = require('pptxgenjs');
        const pres = new pptxgen();

        const { Document, Packer, Paragraph, ImageRun } = require('docx');
        const docxChildren: any[] = [];
        const sizeOf = require('image-size');
        
        for (let i = 1; i <= results.length; i++) {
          const spreadDir = path.join(baseOutDir, `spread-${i}`);
          const pngPath = path.join(spreadDir, `spread-${i}.png`);
          
          if (fs.existsSync(pngPath)) {
            const copyPath = path.join(mergedDir, `spread-${i}.png`);
            fs.copyFileSync(pngPath, copyPath);
            
            const pngImageBytes = fs.readFileSync(pngPath);
            
            // 1. PDF
            const pngImage = await pdfDoc.embedPng(pngImageBytes);
            const pngDims = pngImage.scale(1);
            const page = pdfDoc.addPage([pngDims.width, pngDims.height]);
            page.drawImage(pngImage, {
              x: 0,
              y: 0,
              width: pngDims.width,
              height: pngDims.height,
            });

            // 2. PPTX
            if (i === 1) {
              const aspect = pngDims.width / pngDims.height;
              pres.defineLayout({ name: 'CUSTOM', width: aspect * 10, height: 10 });
              pres.layout = 'CUSTOM';
            }
            const slide = pres.addSlide();
            const base64Str = 'image/png;base64,' + pngImageBytes.toString('base64');
            slide.addImage({ data: base64Str, x: 0, y: 0, w: '100%', h: '100%' });

            // 3. DOCX
            const dimensions = sizeOf(pngPath);
            docxChildren.push(new Paragraph({
              children: [
                new ImageRun({
                  data: pngImageBytes,
                  transformation: {
                    width: 600,
                    height: (600 / dimensions.width) * dimensions.height
                  }
                })
              ]
            }));
          }
        }
        
        const pdfBytes = await pdfDoc.save();
        const pdfPath = path.join(mergedDir, 'merged.pdf');
        fs.writeFileSync(pdfPath, pdfBytes);

        await pres.writeFile({ fileName: path.join(mergedDir, 'merged.pptx') });

        const docxObj = new Document({ sections: [{ properties: {}, children: docxChildren }] });
        const docxBytes = await Packer.toBuffer(docxObj);
        fs.writeFileSync(path.join(mergedDir, 'merged.docx'), docxBytes);

        if (onProgress) onProgress(`[auto-flip] ✅ Compilation Complete! Saved merged.pdf, merged.pptx, and merged.docx!`, results.length, maxPages);
      } catch (e: any) {
        if (onProgress) onProgress(`[auto-flip] ⚠️ Failed to generate documents: ${e.message}`, results.length, maxPages);
      }
    }

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
