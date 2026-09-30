import PQueue from 'p-queue';
import { db } from '../db/index';
import { Extractor, CrawlOptions } from '../pipeline/extractor';
import { URLFilter, FilterRule } from '../pipeline/filter';
import { Fetcher } from '../pipeline/fetcher';
import path from 'path';

// Enforce global rate limiting (max 4 concurrent requests at a time)
export const downloadQueue = new PQueue({ concurrency: 4 });

export class JobRunner {
  static async startJob(
    jobId: string,
    url: string,
    filters: FilterRule[],
    crawlOptions: CrawlOptions = {}
  ) {
    console.log(`[JobRunner] Starting Job ${jobId} (maxPages=${crawlOptions.maxPages ?? 1})...`);

    // 1. Mark job as running in the database
    db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(jobId);

    // 2. Add to the rate-limited queue
    downloadQueue.add(async () => {
      try {
        // Update progress callback
        crawlOptions.onPageVisit = (visited, total, currentUrl, resourcesFound) => {
          const stats = { crawled: visited, max: total, currentUrl, resourcesFound };
          db.prepare("UPDATE jobs SET stats = ? WHERE id = ?").run(JSON.stringify(stats), jobId);
        };
        
        crawlOptions.isCancelled = () => {
          const job = db.prepare("SELECT status FROM jobs WHERE id = ?").get(jobId) as { status: string } | undefined;
          return job?.status === 'cancelled';
        };

        const extractor = new Extractor();

        let rawUrls: string[] = [];
        let cookies = '';

        if (crawlOptions.directResourceUrls && crawlOptions.directResourceUrls.length > 0) {
          rawUrls = crawlOptions.directResourceUrls;
          console.log(`[JobRunner] Using ${rawUrls.length} direct resource URLs (skipping crawl).`);
          
          // Optionally get cookies if needed, or we might need to assume the fetcher has access.
          // The Interactive Browser uses the same persistent profile, so Fetcher will need cookies.
          // Let's grab them quickly using a headless instance just to get the session cookies.
          try {
            const userDataDir = path.join(process.cwd(), 'data', 'browser_session');
            const { chromium } = require('playwright-extra');
            const context = await chromium.launchPersistentContext(userDataDir, { headless: true });
            const browserCookies = await context.cookies();
            cookies = browserCookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
            await context.close();
          } catch {}
        } else {
          // Normal crawl
          const waitTime = crawlOptions.waitTimeMs || 4000;
          const result = await extractor.extractNetwork(url, waitTime, crawlOptions);
          rawUrls = result.urls;
          cookies = result.cookies;
        }

        // Filter to only what the user wants
        const filterEngine = new URLFilter(filters || []);
        const allowed = rawUrls.filter(u => filterEngine.isAllowed(u));

        console.log(`[JobRunner] Found ${allowed.length} allowed resources across all pages.`);

        const fetcher = new Fetcher();
        const destDir = path.join(process.cwd(), 'data', 'downloads', jobId);

        // Download all allowed resources
        for (const targetUrl of allowed) {
          try {
            const info = db.prepare(
              "INSERT INTO resources (jobId, url, status) VALUES (?, ?, 'pending')"
            ).run(jobId, targetUrl);
            const resId = info.lastInsertRowid;

            const localPath = await fetcher.downloadResource(targetUrl, destDir, cookies);

            db.prepare(
              "UPDATE resources SET localPath = ?, status = 'downloaded' WHERE id = ?"
            ).run(localPath, resId);
          } catch (e) {
            console.error(`[JobRunner] Failed to download ${targetUrl}`, e);
          }
        }

        db.prepare("UPDATE jobs SET status = 'completed' WHERE id = ?").run(jobId);
        console.log(`[JobRunner] Job ${jobId} completed.`);
      } catch (err) {
        db.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").run(jobId);
        console.error(`[JobRunner] Job failed:`, err);
      }
    });
  }
}
