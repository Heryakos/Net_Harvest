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

    const getFolderForExtension = (ext: string) => {
      if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) return 'images';
      if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'videos';
      if (['mp3', 'wav', 'ogg', 'aac'].includes(ext)) return 'audio';
      if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return 'fonts';
      if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) return 'scripts';
      if (['css', 'scss', 'sass', 'less'].includes(ext)) return 'styles';
      if (['json', 'xml', 'csv', 'yaml', 'yml'].includes(ext)) return 'data';
      if (['glb', 'gltf', 'obj', 'fbx'].includes(ext)) return '3d-models';
      return 'other';
    };

    if (!resources || resources.length === 0) {
      // Fallback: Check if the directory exists directly (used by interactive test_single_image)
      const directDir = path.join(process.cwd(), 'data', 'downloads', jobId);
      if (!fs.existsSync(directDir)) {
        return reject(new Error('No downloaded files found for this job.'));
      }
      
      const tmpPath = path.join(os.tmpdir(), `job-${jobId}.zip`);
      const output = fs.createWriteStream(tmpPath);
      const archive = new ZipArchive({ zlib: { level: 6 } });
      output.on('close', () => resolve(tmpPath));
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(directDir, false);
      archive.finalize();
      return;
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
    let manifestCsv = "Original URL,Local Path\n";
    
    for (const resource of resources) {
      if (resource.localPath && fs.existsSync(resource.localPath)) {
        const filename = resource.localPath.split(/[/\\]/).pop();
        if (filename) {
          const ext = filename.split('.').pop()?.toLowerCase() || '';
          const folder = getFolderForExtension(ext);
          const zipPath = `${folder}/${filename}`;
          
          archive.file(resource.localPath, { name: zipPath });
          manifestCsv += `"${resource.url}","${zipPath}"\n`;
          added++;
        }
      }
    }
    
    // Add the manifest file to the root of the ZIP
    if (added > 0) {
      archive.append(manifestCsv, { name: 'manifest.csv' });
    }

    if (added === 0) {
      return reject(new Error('No files exist on disk for this job.'));
    }

    archive.finalize();
  });
}
