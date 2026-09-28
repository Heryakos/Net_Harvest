import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as cheerio from 'cheerio';

export interface ExtractionRule {
  selector: string;
  attribute: string;
}

export interface CrawlOptions {
  /** Max number of pages to visit (default: 1 = single page only) */
  maxPages?: number;
  /** How long to wait after page load for lazy content (ms) */
  waitTimeMs?: number;
  /** Stay within same origin only */
  sameOriginOnly?: boolean;
}

export class Extractor {
  // Legacy Cheerio extraction for standard HTML (fallback)
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
   * Multi-page network interceptor using Playwright.
   * Visits the start URL, then follows discovered links up to `maxPages`.
   * Returns all unique resource URLs seen across all visited pages.
   */
  async extractNetwork(
    startUrl: string,
    waitTimeMs = 5000,
    options: CrawlOptions = {}
  ): Promise<string[]> {
    const { maxPages = 1, sameOriginOnly = true } = options;

    console.log(`[Extractor] Starting crawl: ${startUrl} (maxPages=${maxPages})`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      // Realistic user agent so sites don't block us
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    });

    const resourceUrls = new Set<string>();
    const visitedPages = new Set<string>();
    const pageQueue: string[] = [startUrl];

    let origin: string;
    try {
      origin = new URL(startUrl).origin;
    } catch {
      origin = '';
    }

    while (pageQueue.length > 0 && visitedPages.size < maxPages) {
      const currentUrl = pageQueue.shift()!;
      if (visitedPages.has(currentUrl)) continue;
      visitedPages.add(currentUrl);

      console.log(`[Extractor] Visiting page ${visitedPages.size}/${maxPages}: ${currentUrl}`);

      const page = await context.newPage();

      // Intercept ALL network responses
      page.on('response', response => {
        const reqUrl = response.url();
        if (reqUrl.startsWith('http')) {
          resourceUrls.add(reqUrl);
        }
      });

      try {
        await page.goto(currentUrl, { waitUntil: 'networkidle', timeout: 30000 });
        // Extra wait for lazy-loaded WebGL textures / React hooks
        await page.waitForTimeout(waitTimeMs);

        // Auto-scroll to trigger lazy-loaded images
        await page.evaluate(async () => {
          await new Promise<void>(resolve => {
            let totalHeight = 0;
            const distance = 300;
            const timer = setInterval(() => {
              window.scrollBy(0, distance);
              totalHeight += distance;
              if (totalHeight >= document.body.scrollHeight) {
                clearInterval(timer);
                resolve();
              }
            }, 100);
          });
        });
        await page.waitForTimeout(1000);

        // Discover links for multi-page crawl
        if (maxPages > 1) {
          const links = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href]'))
              .map((a: any) => a.href as string)
              .filter(href => href.startsWith('http'));
          });

          for (const link of links) {
            try {
              const linkOrigin = new URL(link).origin;
              const normalised = link.split('#')[0]; // strip hash fragments
              if (
                !visitedPages.has(normalised) &&
                !pageQueue.includes(normalised) &&
                (!sameOriginOnly || linkOrigin === origin)
              ) {
                pageQueue.push(normalised);
              }
            } catch {}
          }
        }
      } catch (e) {
        console.error(`[Extractor] Error on page ${currentUrl}:`, e);
      }

      await page.close();
    }

    await browser.close();

    console.log(
      `[Extractor] Crawl complete. Visited ${visitedPages.size} pages, found ${resourceUrls.size} unique resource URLs.`
    );
    return Array.from(resourceUrls);
  }
}
