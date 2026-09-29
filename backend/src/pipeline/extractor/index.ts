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
  onPageVisit?: (visited: number, total: number, url: string, resourcesFound: number) => void;
  /** Function to check if the job was cancelled */
  isCancelled?: () => boolean;
  /** Seed URLs to start from (e.g., iframe pages captured from the current browser position) */
  seedUrls?: string[];
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
      onPageVisit,
      seedUrls
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
    let visitedCount = 0;

    let origin = '';
    try { origin = new URL(startUrl).origin; } catch {}

    const normalise = (url: string) => url.split('#')[0].split('?')[0];

    // Detect sequential URL patterns like page0004.xhtml -> expand to page0004, page0005, ...pageN
    const expandSequentialUrls = (urls: string[]): string[] => {
      if (!urls.length) return urls;
      for (const url of urls) {
        // Match URLs ending in a zero-padded number before the extension, e.g. /Text/page0004.xhtml
        const m = url.match(/^(https?:\/\/.+\/)([a-zA-Z_-]*)(\d{2,6})(\.[a-zA-Z0-9]+)$/);
        if (!m) continue;
        const [, baseDir, filePrefix, numStr, fileSuffix] = m;
        const padLen = numStr.length;
        const startNum = parseInt(numStr, 10);
        const expanded: string[] = [];
        for (let i = startNum; i < startNum + maxPages; i++) {
          expanded.push(`${baseDir}${filePrefix}${String(i).padStart(padLen, '0')}${fileSuffix}`);
        }
        console.log(`[Extractor] Sequential pattern detected — generating ${expanded.length} page URLs from page ${startNum} onwards.`);
        return expanded;
      }
      return urls; // no pattern found, return as-is
    };

    // Build initial queue: seed URLs (from browser capture) take priority over startUrl
    let initialQueue: string[];
    if (seedUrls && seedUrls.length > 0) {
      console.log(`[Extractor] Using ${seedUrls.length} seed URLs from browser capture.`);
      initialQueue = expandSequentialUrls(seedUrls);
    } else {
      initialQueue = [startUrl];
    }
    const pageQueue: string[] = [...initialQueue];

    // When we have seed URLs, we know exactly how many pages to visit.
    // Override maxPages to at least match the queue size.
    const effectiveMaxPages = seedUrls && seedUrls.length > 0
      ? Math.max(maxPages, initialQueue.length)
      : maxPages;

    const visitPage = async (url: string) => {
      const page = await context.newPage();

      // Track all network responses (images, scripts, media, etc.)
      page.on('response', response => {
        const u = response.url();
        if (u.startsWith('http')) resourceUrls.add(u);
      });

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(waitTimeMs);

        // Auto-scroll to trigger lazy-loaded content
        await page.evaluate(async (selector) => {
          await new Promise<void>(resolve => {
            const scroller = selector ? document.querySelector(selector) : (document.scrollingElement || document.body);
            if (!scroller) return resolve();

            let lastHeight = scroller.scrollHeight;
            let unchangedCount = 0;
            const distance = 600;
            const maxScrolls = 100;
            let scrollCount = 0;

            const interval = setInterval(() => {
              scroller.scrollBy(0, distance);
              if (selector) window.scrollBy(0, distance);
              scrollCount++;

              const newHeight = scroller.scrollHeight;
              if (newHeight === lastHeight) {
                unchangedCount++;
                if (unchangedCount >= 6 || scrollCount >= maxScrolls) {
                  clearInterval(interval);
                  scroller.scrollTo(0, 0);
                  resolve();
                }
              } else {
                lastHeight = newHeight;
                unchangedCount = 0;
              }
            }, 250);
          });
        }, targetSelector).catch(() => {});

        await page.waitForTimeout(800);

        // ── Targeted DOM extraction ──────────────────────────────────────────
        if (targetSelector) {
          const { domUrls, iframeSrcs } = await page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (!el) return { domUrls: [], iframeSrcs: [] };

            const urls: string[] = [];
            const iframes: string[] = [];

            const extractFromNode = (root: Element | Document, baseUrl: string) => {
              root.querySelectorAll<HTMLImageElement>('img').forEach(img => {
                if (img.src) urls.push(img.src);
                if (img.dataset.src) urls.push(new URL(img.dataset.src, baseUrl).href);
              });
              root.querySelectorAll<HTMLVideoElement>('video, source').forEach(v => {
                if (v.src) urls.push(v.src);
              });
              root.querySelectorAll<HTMLAnchorElement>('a').forEach(a => {
                if (a.href && !a.href.startsWith('javascript:')) urls.push(a.href);
              });
              root.querySelectorAll('*').forEach(child => {
                const bg = window.getComputedStyle(child).backgroundImage;
                if (bg && bg !== 'none') {
                  const match = bg.match(/url\(['"]?(.*?)['"]?\)/);
                  if (match && match[1]) urls.push(new URL(match[1], baseUrl).href);
                }
              });

              // Collect iframe srcs for later crawling instead of trying to pierce cross-origin iframes
              root.querySelectorAll<HTMLIFrameElement>('iframe[src]').forEach(iframe => {
                if (!iframe.src || iframe.src.startsWith('javascript:')) return;
                try {
                  // Try same-origin pierce first
                  const idoc = iframe.contentDocument || (iframe.contentWindow as any)?.document;
                  if (idoc) {
                    extractFromNode(idoc, iframe.src);
                  } else {
                    // Cross-origin: queue the iframe src as a page to visit
                    iframes.push(iframe.src);
                  }
                } catch (e) {
                  // Cross-origin: queue the iframe src as a page to visit
                  iframes.push(iframe.src);
                }
              });
            };

            if (el.tagName.toLowerCase() === 'iframe') {
              const iframe = el as HTMLIFrameElement;
              iframes.push(iframe.src);
            } else {
              extractFromNode(el, location.href);
            }

            return { domUrls: urls.filter(Boolean), iframeSrcs: iframes.filter(Boolean) };
          }, targetSelector).catch(() => ({ domUrls: [], iframeSrcs: [] }));

          domUrls.forEach(u => {
            if (u.startsWith('http')) resourceUrls.add(u);
          });

          // Queue iframe src pages so we visit them directly (handles cross-origin iframes)
          for (const src of iframeSrcs) {
            const norm = normalise(src);
            if (!visitedUrls.has(norm) && !pageQueue.includes(norm)) {
              console.log(`[Extractor] Queuing cross-origin iframe for direct visit: ${src}`);
              pageQueue.push(norm);
            }
          }
        }

        // ── Extract images from xhtml / iframe pages (books, ebooks) ──────
        // When we directly visit an xhtml page (e.g., from an iframe src),
        // grab all img/source tags and resolve relative URLs against this page's URL
        const isXhtmlOrEbookPage = url.match(/\.(xhtml|htm|html)$/i) || url.includes('/Text/') || url.includes('/OEBPS/');
        if (isXhtmlOrEbookPage || !targetSelector) {
          const xhtmlUrls = await page.evaluate((pageUrl) => {
            const urls: string[] = [];
            const base = document.querySelector('base')?.href || pageUrl;
            document.querySelectorAll<HTMLImageElement>('img').forEach(img => {
              if (img.src) urls.push(img.src);
            });
            document.querySelectorAll<HTMLSourceElement>('source').forEach(s => {
              if (s.src) urls.push(s.src);
            });
            document.querySelectorAll<HTMLElement>('[style]').forEach(el => {
              const bg = (el as HTMLElement).style.backgroundImage;
              if (bg && bg !== 'none') {
                const match = bg.match(/url\(['"]?(.*?)['"]?\)/);
                if (match && match[1]) {
                  try { urls.push(new URL(match[1], base).href); } catch {}
                }
              }
            });
            return urls.filter(Boolean);
          }, url).catch(() => []);

          xhtmlUrls.forEach(u => {
            if (u.startsWith('http')) resourceUrls.add(u);
          });
        }

        // ── Collect links for multi-page crawling ────────────────────────────
        if (maxPages > 1) {
          const links: string[] = await page.evaluate(() =>
            Array.from(document.querySelectorAll('a[href]'))
              .map((a: any) => a.href)
              .filter((h: string) => h.startsWith('http') && !h.startsWith('javascript:'))
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

      while (visitedCount < effectiveMaxPages && (pageQueue.length > 0 || slots.length > 0)) {
        if (options.isCancelled && options.isCancelled()) {
          console.log(`[Extractor] Crawl cancelled, aborting queue.`);
          break;
        }

        // Fill available concurrency slots
        while (slots.length < concurrency && visitedCount < effectiveMaxPages && pageQueue.length > 0) {
          const url = pageQueue.shift()!;
          const norm = normalise(url);
          if (visitedUrls.has(norm)) continue;
          visitedUrls.add(norm);
          visitedCount++;

          onPageVisit?.(visitedCount, maxPages, url, resourceUrls.size);
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
