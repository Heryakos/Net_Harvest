import Fastify from 'fastify';
import cors from '@fastify/cors';
import { JobModel } from './jobs/jobModel';
import { randomUUID } from 'crypto';
import { Extractor } from './pipeline/extractor';
import { URLFilter, FilterRule } from './pipeline/filter';
import { JobRunner } from './jobs/runner';
import { buildJobZip } from './pipeline/packager';
import fs from 'fs';
import path from 'path';
import { Browser, Page, BrowserContext } from 'playwright';
const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(stealthPlugin());
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

const fastify = Fastify({ logger: true });
fastify.register(cors, { origin: true });

// â”€â”€â”€ Health & Jobs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
fastify.get('/ping', async () => ({ status: 'ok' }));
fastify.get('/api/jobs', async () => JobModel.getAllJobs());

fastify.post('/api/jobs', async (request, reply) => {
  const { startUrl, filters, maxPages, sameOriginOnly, targetSelector, crawlSpeed, seedUrls, directResourceUrls, sessionCookies, jobId: reqJobId } = request.body as any;
  if (!startUrl) return reply.status(400).send({ error: 'startUrl is required' });
  const jobId = reqJobId || randomUUID();
  const job = JobModel.createJob(jobId, startUrl);

  let waitTimeMs = 4000;
  let concurrency = 3;
  if (crawlSpeed === 'slow') { waitTimeMs = 8000; concurrency = 1; }
  else if (crawlSpeed === 'fast') { waitTimeMs = 1500; concurrency = 6; }

  const hasSeedUrls = seedUrls && seedUrls.length > 0;
  JobRunner.startJob(jobId, startUrl, filters || [], {
    maxPages: Math.min(Number(maxPages) || 1, 1000),
    sameOriginOnly: hasSeedUrls ? false : (sameOriginOnly !== false),
    targetSelector,
    waitTimeMs,
    concurrency,
    seedUrls: hasSeedUrls ? seedUrls : undefined,
    directResourceUrls: directResourceUrls,
    sessionCookies: sessionCookies || ''
  });
  return reply.status(201).send(job);
});

// â”€â”€â”€ Cancel Job â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
fastify.post('/api/jobs/:id/cancel', async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const { db } = require('./db/index'); // dynamic require to avoid circular deps if any, or just import db at the top
    db.prepare("UPDATE jobs SET status = 'cancelled' WHERE id = ?").run(id);
    return reply.send({ success: true });
  } catch (err: any) {
    return reply.status(500).send({ error: err.message });
  }
});

// â”€â”€â”€ Download ZIP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Live filter preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
fastify.post('/api/preview', async (request, reply) => {
  const { url, filters, maxPages, targetSelector } = request.body as {
    url: string; filters: FilterRule[]; maxPages?: number; targetSelector?: string;
  };
  if (!url) return reply.status(400).send({ error: 'url required' });
  try {
    const extractor = new Extractor();
    const { urls: rawUrls } = await extractor.extractNetwork(url, 3000, {
      maxPages: Math.min(Number(maxPages) || 1, 5),   // cap preview at 5 pages
      ...(targetSelector ? { targetSelector } : {})
    });
    const filterEngine = new URLFilter(filters || []);
    const allowed = rawUrls.filter(u => filterEngine.isAllowed(u));
    const blocked  = rawUrls.filter(u => !filterEngine.isAllowed(u));
    return reply.send({ total: rawUrls.length, allowed, blocked });
  } catch (err: any) {
    return reply.status(500).send({ error: err.message });
  }
});

// â”€â”€â”€ Auto-detect file types on a URL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
fastify.post('/api/detect', async (request, reply) => {
  const { url } = request.body as { url: string };
  if (!url) return reply.status(400).send({ error: 'url required' });
  try {
    const extractor = new Extractor();
    const { urls: rawUrls } = await extractor.extractNetwork(url, 4000, { maxPages: 1 });

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
        const catSet = categories[category as keyof typeof categories];
        if (catSet) catSet.add(ext);
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

// â”€â”€â”€ Start HTTP server, then attach raw WebSocket server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });

    // Attach a raw ws.Server to the same HTTP server Fastify created
    const httpServer = fastify.server as http.Server;
    const wss = new WebSocketServer({ server: httpServer, path: '/api/browser/session' });

    wss.on('connection', (socket: WebSocket) => {
      const sessionId = randomUUID();
      let browserContext: BrowserContext | null = null;
      let page: Page | null = null;
      let screenshotInterval: NodeJS.Timeout | null = null;
      let recordInterval: NodeJS.Timeout | null = null;
      const sessionResources = new Map<string, string>();
      const recordedUrls = new Set<string>();

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

      const sendCandidateSelectors = async () => {
        if (!page || socket.readyState !== WebSocket.OPEN) return;
        try {
          const selectors = await page.evaluate(() => {
            const candidates = new Set<string>();
            const extractFromDoc = (doc: Element | Document) => {
              doc.querySelectorAll('[id]').forEach(el => candidates.add('#' + CSS.escape(el.id)));
              doc.querySelectorAll('main, article, section, header, footer, .container, .card, .gallery, .content, .wrapper, .page, .page-wrap').forEach(el => {
                if (el.id) {
                  candidates.add('#' + CSS.escape(el.id));
                } else if (el.className && typeof el.className === 'string') {
                  const classes = el.className.trim().split(/\s+/).filter(Boolean);
                  if (classes.length > 0) candidates.add('.' + CSS.escape(classes[0]!));
                } else {
                  candidates.add(el.tagName.toLowerCase());
                }
              });
              doc.querySelectorAll('iframe').forEach((iframe: any) => {
                try {
                  const idoc = iframe.contentDocument || iframe.contentWindow?.document;
                  if (idoc) extractFromDoc(idoc);
                } catch (e) {}
              });
            };
            extractFromDoc(document);
            return Array.from(candidates).slice(0, 100);
          });
          send({ type: 'candidate_selectors', selectors });
        } catch {}
      };

      const startSession = async (url: string) => {
        if (browserContext) await browserContext.close().catch(() => {});
        sessionResources.clear();

        const userDataDir = path.join(process.cwd(), 'data', 'browser_session');
        if (!fs.existsSync(userDataDir)) {
          fs.mkdirSync(userDataDir, { recursive: true });
        }

        browserContext = await chromium.launchPersistentContext(userDataDir, {
          headless: true,
          viewport: { width: 1920, height: 1080 },
          deviceScaleFactor: 2, // High DPI (Retina) for crisp screenshots
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
        });
        page = (browserContext!.pages().length > 0 ? browserContext!.pages()[0]! : await browserContext!.newPage()) as Page;

        if (!page) return;
        page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
        page.on('pageerror', err => console.error(`[Browser Error] ${err.message}`));

        // Handle new tabs (target="_blank") so they don't open invisibly in the background
        page.on('popup', async (popup) => {
          const popupUrl = popup.url();
          // Navigate the main page to the new URL and close the invisible popup
          await page!.goto(popupUrl, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
          send({ type: 'navigated', url: page!.url() });
          sendCandidateSelectors();
          await popup.close().catch(() => {});
        });



        await page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
        screenshotInterval = setInterval(sendScreenshot, 200); // 5fps

        send({ type: 'session_ready', sessionId });
        send({ type: 'navigated', url: page.url() });
        sendCandidateSelectors();
      };

      socket.on('message', async (raw: Buffer) => {
        let msg: any;
        try { 
          msg = JSON.parse(raw.toString()); 
          if (msg.type !== 'mousemove') console.log('[WS IN]', msg);
        } catch { return; }

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
              sendCandidateSelectors();
              break;

            case 'pick_element': {
              const vp = page!.viewportSize() ?? { width: 1280, height: 720 };
              const px = (msg.x / 100) * vp.width;
              const py = (msg.y / 100) * vp.height;
              
              const selector = await page!.evaluate(({ x, y }) => {
                const getPath = (el: any): string => {
                  try {
                    if (el.id) return '#' + CSS.escape(el.id);
                    if (el === document.body || !el.tagName) return 'body';
                    let path = '';
                    while (el && el !== document.body) {
                      if (el.id) {
                        path = '#' + CSS.escape(el.id) + (path ? ' > ' + path : '');
                        break;
                      }
                      let selector = el.tagName.toLowerCase();
                      if (el.className && typeof el.className === 'string') {
                        const classes = el.className.trim().split(/\s+/).filter((c: string) => c).map(CSS.escape);
                        if (classes.length > 0) selector += '.' + classes.join('.');
                      }
                      let siblingIndex = 1;
                      let sibling = el.previousElementSibling;
                      while (sibling) {
                        siblingIndex++;
                        sibling = sibling.previousElementSibling;
                      }
                      selector += `:nth-child(${siblingIndex})`;
                      path = selector + (path ? ' > ' + path : '');
                      el = el.parentElement;
                    }
                    return path || 'body';
                  } catch (err) {
                    return 'body';
                  }
                };

                // Clear highlight first so it doesn't pick the highlight overlay
                const overlay = document.getElementById('netHarvestOverlay');
                if (overlay) overlay.style.pointerEvents = 'none'; // Ensure it's not pickable
                
                const elements = document.elementsFromPoint(x, y);
                let target = null;
                for (const el of elements) {
                  // Skip our own overlay
                  if (el.id === 'netHarvestOverlay') continue;
                  
                  // Skip massive fullscreen transparent overlays (like swipe catchers)
                  const rect = el.getBoundingClientRect();
                  const isFullScreen = (rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.95);
                  if (isFullScreen && el.tagName.toLowerCase() === 'div' && el.children.length === 0) {
                     continue; // Skip empty fullscreen divs
                  }
                  
                  target = el;
                  break;
                }
                
                if (overlay) document.body.removeChild(overlay); // Clean up
                
                if (!target) return 'body';
                return getPath(target);
              }, { x: px, y: py }).catch(() => 'body');
              
              send({ type: 'picked_selector', selector });
              break;
            }

            case 'highlight_element': {
              const vp = page!.viewportSize() ?? { width: 1280, height: 720 };
              const px = (msg.x / 100) * vp.width;
              const py = (msg.y / 100) * vp.height;

              await page!.evaluate(({ x, y }) => {
                let overlay = document.getElementById('netHarvestOverlay');
                if (!overlay) {
                  overlay = document.createElement('div');
                  overlay.id = 'netHarvestOverlay';
                  Object.assign(overlay.style, {
                    position: 'fixed', top: '0', left: '0', width: '0', height: '0',
                    background: 'rgba(59,130,246,0.3)', border: '2px solid #3b82f6',
                    pointerEvents: 'none', zIndex: '999999', transition: 'all 0.05s'
                  });
                  document.body.appendChild(overlay);
                } else {
                  overlay.style.pointerEvents = 'none'; // Ensure not pickable temporarily
                }
                
                // Hide overlay temporarily to find element underneath
                overlay.style.display = 'none';
                const elements = document.elementsFromPoint(x, y);
                let target = null;
                for (const el of elements) {
                  if (el.id === 'netHarvestOverlay') continue;
                  
                  const rect = el.getBoundingClientRect();
                  const isFullScreen = (rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.95);
                  if (isFullScreen && el.tagName.toLowerCase() === 'div' && el.children.length === 0) {
                     continue;
                  }
                  target = el;
                  break;
                }
                overlay.style.display = 'block';

                if (target) {
                  const rect = target.getBoundingClientRect();
                  overlay.style.top = rect.top + 'px';
                  overlay.style.left = rect.left + 'px';
                  overlay.style.width = rect.width + 'px';
                  overlay.style.height = rect.height + 'px';
                }
              }, { x: px, y: py }).catch(() => {});
              break;
            }

            case 'clear_highlight':
              await page!.evaluate(() => {
                const overlay = document.getElementById('netHarvestOverlay');
                if (overlay) document.body.removeChild(overlay);
              }).catch(() => {});
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
              send({ type: 'resources', resources: Array.from(sessionResources.keys()) });
              break;

            case 'get_candidate_selectors':
              await sendCandidateSelectors();
              break;

            case 'get_iframe_srcs': {
              // Capture all iframe src URLs from the current page, optionally filtered by a selector
              const iframeSrcs = await page!.evaluate((selector) => {
                const root: Element | Document = selector ? (document.querySelector(selector) || document) : document;
                const srcs: string[] = [];
                root.querySelectorAll('iframe[src]').forEach((iframe: any) => {
                  if (iframe.src && !iframe.src.startsWith('javascript:')) {
                    srcs.push(iframe.src);
                  }
                });
                return srcs;
              }, msg.selector || null).catch(() => []);
              send({ type: 'iframe_srcs', srcs: iframeSrcs, currentUrl: page!.url() });
              break;
            }

            
            case 'capture_visible_spread': {
              if (!page) {
                send({ type: 'error', message: 'No active browser page' });
                return;
              }
              const { CambridgeReaderEngine } = require('./engine');
              const engine = new CambridgeReaderEngine(page);
              engine.selector = msg.targetSelector || '#readium-right-content';
              
              const jobId = msg.jobId || 'interactive_' + Date.now();
              const destDir = require('path').join(process.cwd(), 'data', 'downloads', jobId);
              
              send({ type: 'capture_log', log: `Starting capture on selector: ${engine.selector}` });
              
              try {
                const results = await engine.captureVisibleSpread(destDir, (progress: string) => {
                  send({ type: 'capture_log', log: progress });
                });
                
                send({ type: 'capture_log', log: `Successfully extracted ${results.length} pages!` });
                send({ type: 'capture_success', results, jobId });
              } catch (e: any) {
                send({ type: 'capture_log', log: `ERROR: ${e.message}` });
                send({ type: 'error', message: e.message });
              }
              break;
            }

            case 'capture_auto_flip': {
              if (!page) {
                send({ type: 'error', message: 'No active browser page' });
                return;
              }
              const { CambridgeReaderEngine } = require('./engine');
              const engine = new CambridgeReaderEngine(page);
              engine.selector = msg.targetSelector || '#readium-right-content';
              
              const jobId = msg.jobId || 'interactive_' + Date.now();
              const destDir = require('path').join(process.cwd(), 'data', 'downloads', jobId);
              const maxPages = Number(msg.maxPages) || 99999;
              const nextButtonSelector = msg.nextButtonSelector || '';
              const pdfOnlyMode = Boolean(msg.pdfOnlyMode);
              
              send({ type: 'capture_log', log: `Starting auto-flip capture (Max: ${maxPages > 9000 ? 'Unlimited' : maxPages} spreads)...` });
              
              try {
                const results = await engine.captureAutoFlip(destDir, maxPages, nextButtonSelector, pdfOnlyMode, (log: string, current?: number, total?: number) => {
                  send({ type: 'capture_log', log, current, total });
                });
                
                send({ type: 'capture_success', results, jobId });
              } catch (e: any) {
                send({ type: 'capture_log', log: `ERROR: ${e.message}` });
                send({ type: 'error', message: e.message });
              }
              break;
            }

            case 'test_single_image': {
              if (!page) {
                send({ type: 'error', message: 'No active browser page' });
                return;
              }
              const { CambridgeReaderEngine } = require('./engine');
              const engine = new CambridgeReaderEngine(page);
              engine.selector = msg.targetSelector || '#readium-right-content';
              
              const jobId = msg.jobId || 'interactive_' + Date.now();
              const destDir = require('path').join(process.cwd(), 'data', 'downloads', jobId);
              
              send({ type: 'capture_log', log: `▶ Button pressed. Target: "${engine.selector}"` });
              
              try {
                const trace = (progress: string) => send({ type: 'capture_log', log: progress });
                const result = await engine.captureSingleImage(destDir, trace);
                
                send({ type: 'capture_log', log: `✅ Successfully saved ZIP!` });
                send({ type: 'capture_success', results: result, jobId });
              } catch (e: any) {
                send({ type: 'capture_log', log: `❌ ERROR: ${e.message}` });
                send({ type: 'error', message: e.message });
              }
              break;
            }

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
        if (recordInterval) clearInterval(recordInterval);
        if (browserContext) await browserContext.close().catch(() => {});
        console.log(`[WS] Session ${sessionId} closed.`);
      });

      socket.on('error', () => {
        if (screenshotInterval) clearInterval(screenshotInterval);
        if (recordInterval) clearInterval(recordInterval);
        browserContext?.close().catch(() => {});
      });
    });

    console.log('[WS] Interactive browser WebSocket server ready at ws://localhost:3000/api/browser/session');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

