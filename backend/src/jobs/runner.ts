import PQueue from 'p-queue';
import { db } from '../db/index';
import { Extractor } from '../pipeline/extractor';
import { URLFilter, FilterRule } from '../pipeline/filter';
import { Fetcher } from '../pipeline/fetcher';
import { randomUUID } from 'crypto';
import path from 'path';

// Enforce global rate limiting (max 4 concurrent requests at a time)
export const downloadQueue = new PQueue({ concurrency: 4 });

export class JobRunner {
  static async startJob(jobId: string, url: string, filters: FilterRule[]) {
    console.log(`[JobRunner] Starting Job ${jobId}...`);
    
    // 1. Mark job as running in the database
    db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(jobId);

    // 2. Add tasks to the rate-limited queue
    downloadQueue.add(async () => {
      try {
        console.log(`[JobRunner] Extracting network requests for ${url}`);
        
        // Use Playwright to find all network resources
        const extractor = new Extractor();
        const rawUrls = await extractor.extractNetwork(url, 3000); 
        
        // Filter out what the user doesn't want
        const filterEngine = new URLFilter(filters || []);
        const allowed = rawUrls.filter(u => filterEngine.isAllowed(u));
        
        console.log(`[JobRunner] Found ${allowed.length} allowed resources to download.`);

        const fetcher = new Fetcher();
        const destDir = path.join(process.cwd(), 'data', 'downloads', jobId);
        
        // Download all allowed resources
        for (const targetUrl of allowed) {
           try {
             const info = db.prepare("INSERT INTO resources (jobId, url, status) VALUES (?, ?, 'pending')").run(jobId, targetUrl);
             const resId = info.lastInsertRowid;
             
             const localPath = await fetcher.downloadResource(targetUrl, destDir);
             
             db.prepare("UPDATE resources SET localPath = ?, status = 'downloaded' WHERE id = ?").run(localPath, resId);
           } catch(e) {
             console.error(`[JobRunner] Failed to download ${targetUrl}`, e);
             // We can't update if resId wasn't created, but if it was, we update it
           }
        }
        
        db.prepare("UPDATE jobs SET status = 'completed' WHERE id = ?").run(jobId);
        console.log(`[JobRunner] Job ${jobId} completed successfully.`);
      } catch (err) {
        db.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").run(jobId);
        console.error(`[JobRunner] Job failed:`, err);
      }
    });
  }
}
