import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Resolve the DB path to the 'data' folder at the root of our monorepo
const dbPath = path.resolve(__dirname, '../../../../data/extractor.db');

// Ensure the directory exists before connecting
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

// Open the database connection synchronously
export const db = new Database(dbPath);

// Enable Write-Ahead Logging for better concurrent read/write performance
db.pragma('journal_mode = WAL');

// Define our initial database schema
const schema = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL, -- 'running', 'paused', 'completed', 'failed'
  startUrl TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jobId TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL, -- 'pending', 'fetching', 'downloaded', 'failed'
  errorMessage TEXT,
  retryCount INTEGER DEFAULT 0,
  localPath TEXT,
  FOREIGN KEY(jobId) REFERENCES jobs(id)
);
`;

// Execute the schema creation
db.exec(schema);
