import { chromium } from 'playwright';
import * as cheerio from 'cheerio';

export interface ExtractionRule {
  selector: string;
  attribute: string; 
}

export class Extractor {
  // Legacy Cheerio extraction for standard HTML (Stage 7 fallback)
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

  // 🔥 NEW: Playwright Network Interceptor for advanced JS/3D sites!
  async extractNetwork(url: string, waitTimeMs = 5000): Promise<string[]> {
    console.log(`[Extractor] Booting Playwright headless browser for ${url}...`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    const resourceUrls = new Set<string>();

    // Spy on ALL network traffic, exactly like the Chrome Network tab
    page.on('response', response => {
      const reqUrl = response.url();
      // Keep only actual network requests (ignore data:image base64 strings)
      if (reqUrl.startsWith('http')) {
        resourceUrls.add(reqUrl);
      }
    });

    try {
      // Go to page and wait for the network to be mostly idle
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      // Wait a few extra seconds for WebGL textures or React hooks to finish fetching
      await page.waitForTimeout(waitTimeMs);
    } catch (e) {
      console.error("[Extractor] Page load warning:", e);
    }

    await browser.close();
    
    // Return an array of all unique URLs requested by the website
    return Array.from(resourceUrls);
  }
}
