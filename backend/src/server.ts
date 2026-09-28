import Fastify from 'fastify';
import cors from '@fastify/cors';
import { JobModel } from './jobs/jobModel';
import { randomUUID } from 'crypto';
import { Extractor } from './pipeline/extractor';
import { URLFilter, FilterRule } from './pipeline/filter';
import { JobRunner } from './jobs/runner';
import { buildJobZip } from './pipeline/packager';
import fs from 'fs';
import { chromium, Browser, Page } from 'playwright';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

const fastify = Fastify({ logger: true });
fastify.register(cors, { origin: true });

// ─── Health & Jobs ────────────────────────────────────────────────────────────
fastify.get('/ping', async () => ({ status: 'ok' }));
fastify.get('/api/jobs', async () => JobModel.getAllJobs());

fastify.post('/api/jobs', async (request, reply) => {
  const { startUrl, filters, maxPages, sameOriginOnly } = request.body as any;
  if (!startUrl) return reply.status(400).send({ error: 'startUrl is required' });
  const jobId = randomUUID();
  const job = JobModel.createJob(jobId, startUrl);
  JobRunner.startJob(jobId, startUrl, filters || [], {
    maxPages: Math.min(Number(maxPages) || 1, 1000),
    sameOriginOnly: sameOriginOnly !== false
  });
  return reply.status(201).send(job);
});

// ─── Download ZIP ─────────────────────────────────────────────────────────────
fastify.get('/api/jobs/:id/download', async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const zipPath = await buildJobZip(id);
    const stat = fs.statSync(zipPath);
    reply.header('Content-Disposition', `attachment; filename="netharvest-${id}.zip"`);
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Length', stat.size);
    return reply.send(fs.createReadStream(zipPath));
  } catch (err: any) {
    return reply.status(400).send({ error: err.message });
  }
});

// ─── Live filter preview ──────────────────────────────────────────────────────
fastify.post('/api/preview', async (request, reply) => {
  const { url, filters, maxPages } = request.body as {
    url: string; filters: FilterRule[]; maxPages?: number;
  };
  if (!url) return reply.status(400).send({ error: 'url required' });
  try {
    const extractor = new Extractor();
    const rawUrls = await extractor.extractNetwork(url, 3000, {
      maxPages: Math.min(Number(maxPages) || 1, 5)   // cap preview at 5 pages
    });
    const filterEngine = new URLFilter(filters || []);
    const allowed = rawUrls.filter(u => filterEngine.isAllowed(u));
    const blocked  = rawUrls.filter(u => !filterEngine.isAllowed(u));
    return reply.send({ total: rawUrls.length, allowed, blocked });
  } catch (err: any) {
    return reply.status(500).send({ error: err.message });
  }
});

// ─── Auto-detect file types on a URL ─────────────────────────────────────────
fastify.post('/api/detect', async (request, reply) => {
  const { url } = request.body as { url: string };
  if (!url) return reply.status(400).send({ error: 'url required' });
  try {
    const extractor = new Extractor();
    const rawUrls = await extractor.extractNetwork(url, 4000, { maxPages: 1 });

    // Bucket by extension
    const categories: Record<string, Set<string>> = {
      Images: new Set(),
      '3D Models': new Set(),
      Video: new Set(),
      Audio: new Set(),
      Documents: new Set(),
      Fonts: new Set(),
      'Web Assets': new Set(),
      Data: new Set(),
      Other: new Set()
    };

    const EXT_MAP: Record<string, string> = {
      '.jpg': 'Images', '.jpeg': 'Images', '.png': 'Images', '.gif': 'Images',
      '.svg': 'Images', '.webp': 'Images', '.bmp': 'Images', '.ico': 'Images',
      '.avif': 'Images', '.tiff': 'Images',
      '.glb': '3D Models', '.gltf': '3D Models', '.obj': '3D Models',
      '.fbx': '3D Models', '.stl': '3D Models', '.ply': '3D Models',
      '.mp4': 'Video', '.webm': 'Video', '.avi': 'Video', '.mov': 'Video',
      '.mkv': 'Video', '.m4v': 'Video',
      '.mp3': 'Audio', '.wav': 'Audio', '.ogg': 'Audio', '.flac': 'Audio',
      '.aac': 'Audio', '.m4a': 'Audio',
      '.pdf': 'Documents', '.doc': 'Documents', '.docx': 'Documents',
      '.xls': 'Documents', '.xlsx': 'Documents', '.txt': 'Documents',
      '.csv': 'Documents', '.ppt': 'Documents', '.pptx': 'Documents',
      '.woff': 'Fonts', '.woff2': 'Fonts', '.ttf': 'Fonts', '.otf': 'Fonts', '.eot': 'Fonts',
      '.js': 'Web Assets', '.css': 'Web Assets', '.wasm': 'Web Assets', '.html': 'Web Assets', '.xhtml': 'Web Assets',
      '.json': 'Data', '.xml': 'Data', '.yaml': 'Data', '.yml': 'Data',
    };

    for (const u of rawUrls) {
      try {
        const pathname = new URL(u).pathname.toLowerCase();
        const ext = '.' + pathname.split('.').pop();
        const category = EXT_MAP[ext] ?? 'Other';
        categories[category].add(ext);
      } catch {}
    }

    // Return only non-empty categories
    const result: Record<string, string[]> = {};
    for (const [cat, exts] of Object.entries(categories)) {
      if (exts.size > 0) result[cat] = Array.from(exts);
    }

    return reply.send({ detected: result, totalUrls: rawUrls.length });
  } catch (err: any) {
    return reply.status(500).send({ error: err.message });
  }
});

// ─── Start HTTP server, then attach raw WebSocket server ─────────────────────
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });

    // Attach a raw ws.Server to the same HTTP server Fastify created
    const httpServer = fastify.server as http.Server;
    const wss = new WebSocketServer({ server: httpServer, path: '/api/browser/session' });

    wss.on('connection', (socket: WebSocket) => {
      const sessionId = randomUUID();
      let browser: Browser | null = null;
      let page: Page | null = null;
      let screenshotInterval: NodeJS.Timeout | null = null;
      const sessionResources = new Set<string>();

      const send = (msg: object) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(msg));
        }
      };

      const sendScreenshot = async () => {
        if (!page || socket.readyState !== WebSocket.OPEN) return;
        try {
          const screenshot = await page.screenshot({ type: 'jpeg', quality: 65 });
          send({ type: 'screenshot', data: screenshot.toString('base64') });
        } catch {}
      };

      const startSession = async (url: string) => {
        if (browser) await browser.close().catch(() => {});
        sessionResources.clear();

        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
          viewport: { width: 1280, height: 720 },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        });
        page = await context.newPage();

        // Handle new tabs (target="_blank") so they don't open invisibly in the background
        page.on('popup', async (popup) => {
          const popupUrl = popup.url();
          // Navigate the main page to the new URL and close the invisible popup
          await page!.goto(popupUrl, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
          send({ type: 'navigated', url: page!.url() });
          await popup.close().catch(() => {});
        });

        page.on('response', response => {
          const u = response.url();
          if (u.startsWith('http')) sessionResources.add(u);
        });

        await page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
        screenshotInterval = setInterval(sendScreenshot, 200); // 5fps

        send({ type: 'session_ready', sessionId });
        send({ type: 'navigated', url: page.url() });
      };

      socket.on('message', async (raw: Buffer) => {
        let msg: any;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        if (!page && msg.type !== 'start') {
          send({ type: 'error', message: 'Send { type: "start", url: "..." } first.' });
          return;
        }

        try {
          switch (msg.type) {
            case 'start':
              send({ type: 'loading' });
              await startSession(msg.url || 'about:blank');
              break;

            case 'navigate':
              await page!.goto(msg.url, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
              send({ type: 'navigated', url: page!.url() });
              break;

            case 'click': {
              const vp = page!.viewportSize() ?? { width: 1280, height: 720 };
              await page!.mouse.click(
                (msg.x / 100) * vp.width,
                (msg.y / 100) * vp.height
              );
              break;
            }

            case 'type':
              await page!.keyboard.type(String(msg.text ?? ''));
              break;

            case 'key':
              await page!.keyboard.press(String(msg.key ?? 'Enter'));
              break;

            case 'scroll':
              await page!.mouse.wheel(0, Number(msg.deltaY ?? 300));
              break;

            case 'get_url':
              send({ type: 'current_url', url: page!.url() });
              break;

            case 'get_resources':
              send({ type: 'resources', resources: Array.from(sessionResources) });
              break;

            case 'screenshot':
              await sendScreenshot();
              break;
          }
        } catch (err: any) {
          send({ type: 'error', message: err.message });
        }
      });

      socket.on('close', async () => {
        if (screenshotInterval) clearInterval(screenshotInterval);
        if (browser) await browser.close().catch(() => {});
        console.log(`[WS] Session ${sessionId} closed.`);
      });

      socket.on('error', () => {
        if (screenshotInterval) clearInterval(screenshotInterval);
        browser?.close().catch(() => {});
      });
    });

    console.log('[WS] Interactive browser WebSocket server ready at ws://localhost:3000/api/browser/session');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
