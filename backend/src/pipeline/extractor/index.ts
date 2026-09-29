import { BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';
const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(stealthPlugin());
import * as cheerio from 'cheerio';

export interface ExtractionRule {
  selector: string;
  attribute: string;
}

export interface CrawlOptions {
  /** Max number of pages to visit (1 = single page, up to 1000) */
  maxPages?: number;
  /** Wait after page load for lazy content (ms) */
  waitTimeMs?: number;
  /** Stay within the same origin */
  sameOriginOnly?: boolean;
  /** Max concurrent page loads (default: 3) */
  concurrency?: number;
  /** CSS selector of a specific element to scroll and extract from (e.g. .card-container) */
  targetSelector?: string;
  /** Called each time a new page is visited */
  onPageVisit?: (visited: number, total: number, url: string) => void;
}

export class Extractor {
  /** Legacy Cheerio extraction (fallback for static HTML) */
  extract(html: string, rule: ExtractionRule, baseUrl: string): string[] {
    const $ = cheerio.load(html);
    const results: string[] = [];
    $(rule.selector).each((_, el) => {
      const val = $(el).attr(rule.attribute);
      if (val) {
        try { results.push(new URL(val, baseUrl).href); } catch {}
      }
    });
    return results;
  }

  /**
   * Multi-page network interceptor.
   * Crawls up to `maxPages` pages starting from `startUrl`,
   * using concurrent browser tabs for speed at scale.
   */
  async extractNetwork(
    startUrl: string,
    waitTimeMs = 4000,
    options: CrawlOptions = {}
  ): Promise<string[]> {
    const {
      maxPages = 1,
      sameOriginOnly = true,
      concurrency = Math.min(3, maxPages),
      targetSelector,
      onPageVisit
    } = options;

    console.log(`[Extractor] Crawling ${startUrl} — maxPages=${maxPages}, concurrency=${concurrency}`);

    const userDataDir = path.join(process.cwd(), 'data', 'browser_session');
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    });

    const resourceUrls = new Set<string>();
    const visitedUrls = new Set<string>();
    const pageQueue: string[] = [startUrl];
    let visitedCount = 0;

    let origin = '';
    try { origin = new URL(startUrl).origin; } catch {}

    const normalise = (url: string) => url.split('#')[0].split('?')[0];

    const visitPage = async (url: string) => {
      const page = await context.newPage();

      page.on('response', response => {
        const u = response.url();
        if (u.startsWith('http')) resourceUrls.add(u);
      });

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(waitTimeMs);

        // Auto-scroll to trigger lazy-loaded content and infinite scrolls
        await page.evaluate(async (selector) => {
          await new Promise<void>(resolve => {
            const scroller = selector ? document.querySelector(selector) : (document.scrollingElement || document.body);
            if (!scroller) return resolve();

            let lastHeight = scroller.scrollHeight;
            let unchangedCount = 0;
            const distance = 600;
            const maxScrolls = 100; // Limit to prevent getting stuck forever
            let scrollCount = 0;

            const interval = setInterval(() => {
              scroller.scrollBy(0, distance);
              // Also scroll window just in case
              if (selector) window.scrollBy(0, distance); 
              scrollCount++;
              
              const newHeight = scroller.scrollHeight;
              if (newHeight === lastHeight) {
                unchangedCount++;
                // If height hasn't changed for 1.5 seconds (6 ticks of 250ms), we're done
                if (unchangedCount >= 6 || scrollCount >= maxScrolls) {
                  clearInterval(interval);
                  scroller.scrollTo(0, 0);
                  resolve();
                }
              } else {
                lastHeight = newHeight;
                unchangedCount = 0; // Reset because we found new content
              }
            }, 250); // 250ms allows time for network fetches and DOM updates
          });
        }, targetSelector).catch(() => {});

        await page.waitForTimeout(800);

        // If a targetSelector is provided, harvest URLs explicitly from its DOM
        if (targetSelector) {
          const domUrls = await page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (!el) return [];
            const urls: string[] = [];
            
            const extractFromNode = (root: Element | Document) => {
              root.querySelectorAll<HTMLImageElement>('img').forEach(img => urls.push(img.src));
              root.querySelectorAll<HTMLVideoElement>('video, source').forEach(v => urls.push(v.src));
              root.querySelectorAll<HTMLAnchorElement>('a').forEach(a => urls.push(a.href));
              root.querySelectorAll('*').forEach(child => {
                const bg = window.getComputedStyle(child).backgroundImage;
                if (bg && bg !== 'none') {
                  const match = bg.match(/url\(['"]?(.*?)['"]?\)/);
                  if (match) urls.push(match[1]);
                }
              });
              
              root.querySelectorAll('iframe').forEach(iframe => {
                try {
                  const idoc = iframe.contentDocument || iframe.contentWindow?.document;
                  if (idoc) extractFromNode(idoc);
                } catch (e) {
                  // ignore cross-origin iframes
                }
              });
            };

            // If the selected element itself is an iframe, pierce it immediately
            if (el.tagName.toLowerCase() === 'iframe') {
               const iframe = el as HTMLIFrameElement;
               try {
                 const idoc = iframe.contentDocument || iframe.contentWindow?.document;
                 if (idoc) extractFromNode(idoc);
               } catch (e) {}
            } else {
               extractFromNode(el);
            }
            
            return urls.filter(Boolean);
          }, targetSelector).catch(() => []);

          domUrls.forEach(u => {
            if (u.startsWith('http')) resourceUrls.add(u);
          });
        }

        // Collect links for further crawling
        if (maxPages > 1) {
          const links: string[] = await page.evaluate(() =>
            Array.from(document.querySelectorAll('a[href]'))
              .map((a: any) => a.href)
              .filter((h: string) => h.startsWith('http'))
          ).catch(() => []);

          for (const link of links) {
            try {
              const norm = normalise(link);
              const linkOrigin = new URL(link).origin;
              if (
                !visitedUrls.has(norm) &&
                !pageQueue.includes(norm) &&
                (!sameOriginOnly || linkOrigin === origin)
              ) {
                pageQueue.push(norm);
              }
            } catch {}
          }
        }
      } catch (e) {
        console.warn(`[Extractor] Page load error on ${url}:`, (e as Error).message);
      } finally {
        await page.close();
      }
    };

    // Process queue with controlled concurrency
    const runQueue = async () => {
      const slots: Promise<void>[] = [];

      while (visitedCount < maxPages && (pageQueue.length > 0 || slots.length > 0)) {
        // Fill available concurrency slots
        while (slots.length < concurrency && visitedCount < maxPages && pageQueue.length > 0) {
          const url = pageQueue.shift()!;
          const norm = normalise(url);
          if (visitedUrls.has(norm)) continue;
          visitedUrls.add(norm);
          visitedCount++;

          onPageVisit?.(visitedCount, maxPages, url);
          console.log(`[Extractor] Visiting [${visitedCount}/${maxPages}]: ${url}`);

          const task = visitPage(url).then(() => {
            slots.splice(slots.indexOf(task), 1);
          });
          slots.push(task);
        }

        if (slots.length > 0) {
          await Promise.race(slots);
        }
      }

      // Wait for any remaining pages to finish
      await Promise.allSettled(slots);
    };

    await runQueue();
    await context.close();

    console.log(
      `[Extractor] Done — visited ${visitedCount} pages, found ${resourceUrls.size} unique resources.`
    );
    return Array.from(resourceUrls);
  }
}
