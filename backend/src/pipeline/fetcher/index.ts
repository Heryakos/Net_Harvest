import { request } from 'undici';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

export class Fetcher {
  private userAgent = 'RuleExtractorBot/1.0 (+http://localhost)';

  /**
   * Fetches raw HTML text from a page.
   */
  async fetchHTML(url: string): Promise<string> {
    console.log(`[Fetcher] Fetching HTML from ${url}`);
    const res = await request(url, {
      headers: { 'User-Agent': this.userAgent, 'Accept': 'text/html,application/xhtml+xml' }
    });
    
    if (res.statusCode !== 200) throw new Error(`Failed to fetch HTML: Status ${res.statusCode}`);
    return res.body.text();
  }

  /**
   * Streams a resource from the network directly to the disk.
   */
  async downloadResource(url: string, destDir: string, cookies?: string): Promise<string> {
    console.log(`[Fetcher] Downloading resource from ${url}`);
    const headers: Record<string, string> = { 'User-Agent': this.userAgent };
    if (cookies) headers['Cookie'] = cookies;
    const res = await request(url, { headers });
    
    if (res.statusCode !== 200) throw new Error(`Failed to download: Status ${res.statusCode}`);
    
    // Parse filename, strip query params, keep safe chars
    let filename = new URL(url).pathname.split('/').pop() || 'downloaded_file';
    filename = filename.replace(/[^A-Za-z0-9._-]/g, ''); 
    if (!filename) filename = `file_${Date.now()}`;

    const localPath = path.join(destDir, filename);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    await pipeline(res.body, fs.createWriteStream(localPath));
    return localPath;
  }
}
