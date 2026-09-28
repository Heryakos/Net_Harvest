import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import { JobModel } from './jobs/jobModel';
import { randomUUID } from 'crypto';
import { Extractor } from './pipeline/extractor';
import { URLFilter, FilterRule } from './pipeline/filter';
import { JobRunner } from './jobs/runner';
import { buildJobZip } from './pipeline/packager';
import fs from 'fs';
import { chromium, Browser, Page } from 'playwright';

const fastify = Fastify({ logger: true });

fastify.register(cors, { origin: true });
fastify.register(fastifyWebsocket);

// ─── Health ──────────────────────────────────────────────────────────────────
fastify.get('/ping', async () => ({ status: 'ok' }));
fastify.get('/api/jobs', async () => JobModel.getAllJobs());

// ─── Create & start extraction job ───────────────────────────────────────────
fastify.post('/api/jobs', async (request, reply) => {
  const { startUrl, filters, maxPages, sameOriginOnly } = request.body as any;
  if (!startUrl) return reply.status(400).send({ error: 'startUrl is required' });

  const jobId = randomUUID();
  const job = JobModel.createJob(jobId, startUrl);
  JobRunner.startJob(jobId, startUrl, filters || [], {
    maxPages: Number(maxPages) || 1,
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
    reply.header('Content-Disposition', `attachment; filename="job-${id}.zip"`);
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
    url: string; filters: FilterRule[]; maxPages?: number
  };
  if (!url) return reply.status(400).send({ error: 'url required' });

  try {
    const extractor = new Extractor();
    const rawUrls = await extractor.extractNetwork(url, 3000, {
      maxPages: Number(maxPages) || 1
    });

    const filterEngine = new URLFilter(filters || []);
    const allowed = rawUrls.filter(u => filterEngine.isAllowed(u));
    const blocked  = rawUrls.filter(u => !filterEngine.isAllowed(u));

    return reply.send({ total: rawUrls.length, allowed, blocked });
  } catch (err: any) {
    return reply.status(500).send({ error: err.message });
  }
});

// ─── Interactive Browser via WebSocket ────────────────────────────────────────
// Each WebSocket connection gets its own headed Playwright session.
// Client → sends JSON commands: { type: 'navigate'|'click'|'type'|'scroll'|'key', ... }
// Server → sends back { type: 'screenshot', data: base64png } every frame

const activeSessions = new Map<string, { browser: Browser; page: Page }>();

fastify.get('/api/browser/session', { websocket: true }, (socket, req) => {
  const sessionId = randomUUID();
  let browser: Browser | null = null;
  let page: Page | null = null;
  let screenshotInterval: NodeJS.Timeout | null = null;

  const sendScreenshot = async () => {
    if (!page || socket.readyState !== 1) return;
    try {
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false });
      socket.send(JSON.stringify({
        type: 'screenshot',
        data: screenshot.toString('base64'),
        format: 'jpeg'
      }));
    } catch {}
  };

  const startSession = async (url: string) => {
    // Close any previous session
    if (browser) await browser.close().catch(() => {});

    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    });
    page = await context.newPage();

    // Track all network resources seen in this session
    const sessionResources = new Set<string>();
    page.on('response', response => {
      const u = response.url();
      if (u.startsWith('http')) sessionResources.add(u);
    });

    await page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(() => {});

    activeSessions.set(sessionId, { browser, page });

    // Stream screenshots at ~5fps
    screenshotInterval = setInterval(sendScreenshot, 200);

    socket.send(JSON.stringify({
      type: 'session_ready',
      sessionId,
      message: 'Interactive browser started. You can navigate, login, click — everything!'
    }));

    // Helper to get current resources on demand
    (socket as any)._getResources = () => Array.from(sessionResources);
  };

  socket.on('message', async (rawMsg: any) => {
    let msg: any;
    try { msg = JSON.parse(rawMsg.toString()); } catch { return; }

    if (!page && msg.type !== 'start') {
      socket.send(JSON.stringify({ type: 'error', message: 'Session not started. Send { type: "start", url: "..." } first.' }));
      return;
    }

    try {
      switch (msg.type) {
        case 'start':
          await startSession(msg.url || 'about:blank');
          break;

        case 'navigate':
          await page!.goto(msg.url, { waitUntil: 'load', timeout: 15000 });
          socket.send(JSON.stringify({ type: 'navigated', url: msg.url }));
          break;

        case 'click': {
          // msg.x and msg.y are percentages of viewport (0-100)
          const vp = page!.viewportSize() ?? { width: 1280, height: 720 };
          const x = (msg.x / 100) * vp.width;
          const y = (msg.y / 100) * vp.height;
          await page!.mouse.click(x, y);
          break;
        }

        case 'type':
          await page!.keyboard.type(msg.text ?? '');
          break;

        case 'key':
          await page!.keyboard.press(msg.key ?? 'Enter');
          break;

        case 'scroll':
          await page!.mouse.wheel(0, msg.deltaY ?? 300);
          break;

        case 'get_url':
          socket.send(JSON.stringify({ type: 'current_url', url: page!.url() }));
          break;

        case 'get_resources': {
          const resources = (socket as any)._getResources?.() ?? [];
          socket.send(JSON.stringify({ type: 'resources', resources }));
          break;
        }

        case 'capture_job': {
          // Start a real extraction job from current session resources + filters
          const resources = (socket as any)._getResources?.() ?? [];
          const filterEngine = new URLFilter(msg.filters || []);
          const allowed = resources.filter((u: string) => filterEngine.isAllowed(u));
          socket.send(JSON.stringify({ type: 'capture_preview', allowed, total: resources.length }));
          break;
        }

        case 'screenshot':
          await sendScreenshot();
          break;

        default:
          socket.send(JSON.stringify({ type: 'error', message: `Unknown command: ${msg.type}` }));
      }
    } catch (err: any) {
      socket.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  socket.on('close', async () => {
    if (screenshotInterval) clearInterval(screenshotInterval);
    if (browser) await browser.close().catch(() => {});
    activeSessions.delete(sessionId);
    console.log(`[WS] Browser session ${sessionId} closed.`);
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
