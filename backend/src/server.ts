import Fastify from 'fastify';
import cors from '@fastify/cors';
import { JobModel } from './jobs/jobModel';
import { randomUUID } from 'crypto';
import { Extractor } from './pipeline/extractor';
import { URLFilter, FilterRule } from './pipeline/filter';
import { JobRunner } from './jobs/runner';
import { buildJobZip } from './pipeline/packager';
import fs from 'fs';

const fastify = Fastify({ logger: true });

fastify.register(cors, { origin: true });

fastify.get('/ping', async () => ({ status: 'ok' }));
fastify.get('/api/jobs', async () => JobModel.getAllJobs());

fastify.post('/api/jobs', async (request, reply) => {
  const { startUrl, filters } = request.body as any;
  if (!startUrl) return reply.status(400).send({ error: 'startUrl is required' });
  const jobId = randomUUID();
  const job = JobModel.createJob(jobId, startUrl);
  JobRunner.startJob(jobId, startUrl, filters || []);
  return reply.status(201).send(job);
});

fastify.get('/api/jobs/:id/download', async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    // Build ZIP to a temp file first (prevents stream-hang with archiver v8)
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

// Upgraded Live Preview API
fastify.post('/api/preview', async (request, reply) => {
  const { url, filters } = request.body as { url: string, filters: FilterRule[] };
  if (!url) return reply.status(400).send({ error: 'url required' });

  try {
    const extractor = new Extractor();
    
    // 🔥 Uses Playwright to catch ALL network requests (like your Chrome DevTools!)
    const rawUrls = await extractor.extractNetwork(url);
    
    const filterEngine = new URLFilter(filters || []);
    const allowed = rawUrls.filter(u => filterEngine.isAllowed(u));
    const blocked = rawUrls.filter(u => !filterEngine.isAllowed(u));

    return reply.send({ total: rawUrls.length, allowed, blocked });
  } catch (err: any) {
    return reply.status(500).send({ error: err.message });
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
