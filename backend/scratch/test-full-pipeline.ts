import { Fetcher } from '../src/pipeline/fetcher';
import { Extractor } from '../src/pipeline/extractor';
import { URLFilter } from '../src/pipeline/filter';
import path from 'path';

async function testFullPipeline() {
  console.log("=== Starting Full Pipeline Test ===");

  const fetcher = new Fetcher();
  const extractor = new Extractor();
  
  // 1. FILTER: Only allow downloading images that end with .jpg or .png
  const filter = new URLFilter([
    { type: 'extension', value: '.png', isInclude: true }
  ]);

  const targetUrl = "https://en.wikipedia.org/wiki/Web_scraping";
  const downloadDir = path.resolve(__dirname, '../../../data/jobs/test-job-123');

  try {
    // 2. DISCOVER/FETCH: Get the HTML of the page
    const html = await fetcher.fetchHTML(targetUrl);
    
    // 3. EXTRACT: Find all <img> tags and get their 'src' attributes
    console.log("[Extractor] Finding images...");
    const rawUrls = extractor.extract(html, { selector: 'img', attribute: 'src' }, targetUrl);
    console.log(`Found ${rawUrls.length} total images on the page.`);

    // 4. FILTER: Apply the filter so we only download .png files
    const allowedUrls = rawUrls.filter(url => filter.isAllowed(url));
    console.log(`After filtering, ${allowedUrls.length} images are allowed to be downloaded.`);

    // 5. DOWNLOAD: Download the first 3 images to prove it works
    const toDownload = allowedUrls.slice(0, 3);
    for (const fileUrl of toDownload) {
      const savedPath = await fetcher.downloadResource(fileUrl, downloadDir);
      console.log(`✅ Success! Downloaded image saved to: ${savedPath}`);
    }

    console.log("=== Test Complete! ===");

  } catch (err) {
    console.error("Pipeline failed:", err);
  }
}

testFullPipeline();
