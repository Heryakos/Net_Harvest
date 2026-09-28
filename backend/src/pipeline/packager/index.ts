import { ZipArchive } from 'archiver';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { db } from '../../db/index';

/**
 * Builds a ZIP archive for the job and resolves with the local path to the .zip file.
 * Writing to disk first avoids stream-finalization bugs with Fastify + archiver v8.
 */
export function buildJobZip(jobId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Fetch all successfully downloaded resources for this job from SQLite
    const resources = db.prepare(
      "SELECT localPath, url FROM resources WHERE jobId = ? AND status = 'downloaded'"
    ).all(jobId) as { localPath: string, url: string }[];

    if (!resources || resources.length === 0) {
      return reject(new Error('No downloaded files found for this job.'));
    }

    // Write to a temp file so we can stream it reliably afterwards
    const tmpPath = path.join(os.tmpdir(), `job-${jobId}.zip`);
    const output = fs.createWriteStream(tmpPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });

    output.on('close', () => resolve(tmpPath));
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', (err: any) => {
      if (err.code !== 'ENOENT') reject(err);
    });

    archive.pipe(output);

    let added = 0;
    for (const resource of resources) {
      if (resource.localPath && fs.existsSync(resource.localPath)) {
        const filename = resource.localPath.split(/[/\\]/).pop();
        if (filename) {
          archive.file(resource.localPath, { name: filename });
          added++;
        }
      }
    }

    if (added === 0) {
      return reject(new Error('No files exist on disk for this job.'));
    }

    archive.finalize();
  });
}
