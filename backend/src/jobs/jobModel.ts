import { db } from '../db/index';

export interface Job {
  id: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  startUrl: string;
  createdAt: string;
}

export interface Resource {
  id: number;
  jobId: string;
  url: string;
  status: 'pending' | 'fetching' | 'downloaded' | 'failed';
  errorMessage?: string;
  retryCount: number;
  localPath?: string;
}

export const JobModel = {
  createJob(id: string, startUrl: string): Job {
    const stmt = db.prepare('INSERT INTO jobs (id, status, startUrl) VALUES (?, ?, ?)');
    stmt.run(id, 'running', startUrl);
    return this.getJob(id)!;
  },

  getJob(id: string): Job | undefined {
    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job | undefined;
  },

  getAllJobs(): Job[] {
    return db.prepare('SELECT * FROM jobs ORDER BY createdAt DESC').all() as Job[];
  }
};
