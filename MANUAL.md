# 📖 NetHarvest — Full Manual

This manual covers everything you need to know about **NetHarvest**, both as an **end user** and as a **developer** who wants to understand the internals or extend the tool.

---

## Table of Contents

1. [User Guide](#-user-guide)
   - [Installation](#installation)
   - [Step 1: Define Target](#step-1-define-target)
   - [Step 2: Configure Filters](#step-2-configure-filters)
   - [Step 3: Download Your Files](#step-3-download-your-files)
   - [Filter Types Explained](#filter-types-explained)
   - [Live Network Tester](#live-network-tester)
2. [Developer Guide](#-developer-guide)
   - [Architecture Overview](#architecture-overview)
   - [Backend Deep Dive](#backend-deep-dive)
   - [Frontend Deep Dive](#frontend-deep-dive)
   - [Database Schema](#database-schema)
   - [API Reference](#api-reference)
   - [Common Issues & Fixes](#common-issues--fixes)

---

## 👤 User Guide

### Installation

```bash
git clone https://github.com/Heryakos/Net_Harvest.git
cd Net_Harvest

# Install all dependencies
npm install
cd backend && npm install && npx playwright install chromium
cd ../frontend && npm install

# Run the app
cd ..
npm run dev
```

Then open **http://localhost:5173** in your browser.

---

### Step 1: Define Target

On the left panel, enter the URL of the website you want to extract resources from.

> **Example:** `https://hiryakos-portfolio.vercel.app/`

On the **right panel**, the website will load live inside a browser frame so you can see exactly what you're targeting. Click **"Next: Configure Filters ➔"** to continue.

---

### Step 2: Configure Filters

This is where you decide **what** to download. The extraction engine intercepts **every** network request the page makes — images, 3D models, fonts, JSON, videos, scripts — just like the Chrome DevTools Network tab.

#### Adding Filters

Click **"+ Add Filter"** to add a rule. Each filter has three parts:

| Part | Options | Meaning |
|---|---|---|
| **Mode** | Include (ALL) | Only download URLs matching ALL Include rules |
| **Mode** | Exclude (ANY) | Skip URLs matching ANY Exclude rule |
| **Type** | Extension | Match by file extension (`.png`, `.glb`, etc.) |
| **Type** | Contains text | Match if URL contains the text |
| **Type** | Starts with | Match if URL starts with the text |
| **Type** | Ends with | Match if URL ends with the text |
| **Type** | Regex | Match using a full regular expression |

For **Extension** type, a **searchable dropdown** appears with 30+ common formats pre-loaded. You can also type your own custom extension.

#### No Filters = Download Everything

If you add **no filters**, NetHarvest will download **all** intercepted network requests. This is useful when you want a complete archive of everything a page loads.

---

### Step 3: Download Your Files

Click **"▶ Start Extraction Job"**. The backend will:

1. Launch a hidden Chrome browser
2. Navigate to your URL
3. Intercept all network traffic
4. Apply your filters
5. Download matching files to the server's local disk

Once the job starts (which takes 10–30 seconds depending on the site), click **"📦 Download ZIP Archive"** to receive all captured resources in a single `.zip` file.

---

### Filter Types Explained

#### Extension Filters
The most common use case. Matches the file extension at the end of the URL path.

```
Include .png  → Downloads all PNG images
Include .glb  → Downloads all 3D GLB model files
Include .gltf → Downloads all 3D GLTF scene files
Exclude .js   → Skips all JavaScript files
```

#### Contains Filters
Matches if the full URL contains the specified substring.

```
Include "cdn.mysite.com"  → Only download from your CDN
Exclude "analytics"       → Skip analytics/tracking requests
```

#### Regex Filters
For power users. Full JavaScript-compatible regular expressions.

```
Include \.(png|jpg|jpeg|webp)$  → Match any image format
Include \/3d\/.*\.glb$          → Match GLB files under /3d/ path
```

---

### Live Network Tester

On Step 2, there is a **"Test Rules Live"** button. Clicking it will:

1. Launch a headless browser and navigate to your URL (~10 seconds)
2. Intercept all network requests
3. Apply your current filters
4. Show you a **preview** of which URLs will be **✅ Allowed** and **❌ Blocked**

This is a dry run — nothing is downloaded yet. Use it to verify your rules before starting the full extraction job.

---

## 🛠️ Developer Guide

### Architecture Overview

```
Browser (React UI)
       │  POST /api/jobs
       ▼
  Fastify Server (port 3000)
       │
       ├─── JobModel (SQLite)
       │         └─ Creates job record
       │
       ├─── JobRunner (p-queue)
       │         ├─ Extractor (Playwright)
       │         │       └─ Intercepts all network requests
       │         ├─ URLFilter
       │         │       └─ Applies user's filter rules
       │         └─ Fetcher (HTTP)
       │                 └─ Downloads allowed resources to disk
       │
       └─── GET /api/jobs/:id/download
                 └─ Packager (archiver)
                         └─ Builds ZIP from disk → streams to browser
```

---

### Backend Deep Dive

#### `src/server.ts` — HTTP API
Fastify server with CORS enabled. Defines all REST endpoints. Delegates work to `JobModel`, `JobRunner`, `Extractor`, and `buildJobZip`.

#### `src/db/index.ts` — SQLite Database
Uses `better-sqlite3` (synchronous SQLite) with WAL journal mode for performance.

Schema:
- `jobs` table — tracks each extraction job (id, url, status, timestamps)
- `resources` table — tracks each intercepted URL (jobId, url, localPath, status)

#### `src/jobs/runner.ts` — Job Execution
Uses `p-queue` with concurrency 4. For each job:
1. Calls `Extractor.extractNetwork(url)` → returns array of intercepted URLs
2. Filters them with `URLFilter`
3. Downloads each with `Fetcher.downloadResource()`
4. Updates SQLite record for each resource

#### `src/pipeline/extractor/` — Playwright Network Interception
Launches a headless Chromium instance. Uses `page.route('**/*')` to intercept every request. Collects request URLs, then aborts the route to prevent the page from loading external resources (saving bandwidth).

Also performs auto-scroll to trigger lazy-loaded content.

#### `src/pipeline/filter/index.ts` — Filter Engine
`URLFilter` class. Takes an array of `FilterRule` objects. The `isAllowed(url)` method:
- If no rules → allow everything
- Evaluates each rule against the URL
- ALL include rules must match
- ANY exclude rule will block

#### `src/pipeline/fetcher/` — HTTP Downloader
Uses `undici` for fast HTTP downloads. Streams responses directly to disk to avoid memory issues with large files. Sanitizes filenames to prevent path traversal.

#### `src/pipeline/packager/index.ts` — ZIP Builder
`buildJobZip(jobId)` function:
1. Queries SQLite for all `status='downloaded'` resources for the job
2. Creates a `ZipArchive` (archiver v8)
3. Pipes it to a temp file (`%TEMP%/job-{id}.zip`)
4. Resolves the Promise when the `close` event fires
5. Returns the temp file path

The server then reads this temp file with `fs.createReadStream()` and sends it with a known `Content-Length` header.

> **Why write to disk first?** `archiver@8.0.0` uses ES Modules and its stream finalization doesn't cleanly signal `END` to Fastify when piped directly. Writing to a temp file and re-streaming avoids this bug.

---

### Frontend Deep Dive

#### `src/App.tsx` — Main Component
3-step wizard:
- **Step 1**: URL input + Live `<iframe>` preview of the website
- **Step 2**: Filter rule builder + Live Network Tester + filter guide
- **Step 3**: Job launched, download ZIP button

Filter dropdowns use `react-select/creatable` for a searchable, type-able experience.

#### `src/index.css` — Glassmorphism Dark Theme
CSS custom properties for theming. `.glass-card` uses `backdrop-filter: blur()` for the frosted glass effect. Dark navy color palette with blue accent gradients.

#### `src/components/FilterGuide.tsx` — Help Panel
A collapsible guide that explains filter modes with examples. Helps first-time users understand Include vs Exclude logic.

---

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  startUrl TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL,
  completedAt TEXT
);

CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jobId TEXT NOT NULL,
  url TEXT NOT NULL,
  localPath TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (jobId) REFERENCES jobs(id)
);
```

---

### API Reference

#### `GET /ping`
Health check. Returns `{ "status": "ok" }`.

#### `GET /api/jobs`
Returns all jobs as a JSON array.

#### `POST /api/jobs`
Starts a new extraction job.

**Request Body:**
```json
{
  "startUrl": "https://example.com",
  "filters": [
    { "type": "extension", "value": ".png", "isInclude": true },
    { "type": "contains",  "value": "cdn",  "isInclude": true },
    { "type": "extension", "value": ".js",  "isInclude": false }
  ]
}
```

**Filter `type` values:**
- `"extension"` — file extension match (e.g. `.png`)
- `"contains"` — URL substring match
- `"starts_with"` — URL prefix match
- `"ends_with"` — URL suffix match
- `"regex"` — full JavaScript RegExp

**Response:** `201 Created` with the job object.

#### `GET /api/jobs/:id/download`
Streams the ZIP archive of all downloaded resources for the job.

Returns `application/zip` with `Content-Disposition: attachment`.

#### `POST /api/preview`
Dry-run: intercepts network traffic and applies filters without downloading anything.

**Request Body:** Same as `POST /api/jobs`

**Response:**
```json
{
  "total": 87,
  "allowed": ["https://...", "..."],
  "blocked": ["https://...", "..."]
}
```

---

### Common Issues & Fixes

| Issue | Cause | Fix |
|---|---|---|
| ZIP download hangs forever | `archiver` v8 stream doesn't end cleanly when piped directly to Fastify | Fixed: write to temp file first, then stream the file |
| `archiver is not a function` | `archiver@8` is ESM — `import archiver from 'archiver'` returns an object, not a function | Fixed: use `new ZipArchive()` from `import { ZipArchive } from 'archiver'` |
| No files in ZIP | Job finished but all resources failed to download (wrong path, 404, etc.) | Check `backend/data/downloads/{jobId}/` for files |
| 3D objects not captured | `.glb` files may load after page interactive event | The extractor auto-scrolls and waits; try increasing the wait time in `extractor/index.ts` |
| Three.js console errors | These come from the target website's own code, not NetHarvest | Safe to ignore |
