# 🌐 NetHarvest

> **Intercept. Filter. Download.** A powerful tool that captures ALL network traffic from any website — just like Chrome DevTools — and lets you download exactly the resources you want.

![NetHarvest Banner](https://img.shields.io/badge/NetHarvest-v1.0-blue?style=for-the-badge&logo=google-chrome)
![Node](https://img.shields.io/badge/Node.js-22.x-green?style=for-the-badge&logo=node.js)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react)
![Playwright](https://img.shields.io/badge/Playwright-1.63-2EAD33?style=for-the-badge&logo=playwright)
![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)

---

## 🚀 What is NetHarvest?

NetHarvest is a **rule-based web resource extractor**. It launches a real Chromium browser in the background, navigates to any URL you give it, intercepts every single network request (images, 3D models, fonts, JSON, videos — everything), applies your custom filters, and packages the results into a downloadable ZIP file.

Think of it as **"Save Page As" on steroids**, but with surgical precision over what you download.

---

## ✨ Features

- 🔍 **Real Network Interception** — Uses Playwright to capture ALL requests (not just `<img>` tags), exactly like Chrome DevTools Network tab
- 🎛️ **Flexible Filter Rules** — Filter by file extension, URL contains, starts/ends with, or full Regex
- 🔎 **Searchable Extension Dropdown** — Pre-loaded with 30+ common extensions (`.png`, `.glb`, `.gltf`, `.mp4`, `.woff2`, etc.)
- 👁️ **Live Browser View** — See your target website rendered live inside the app while configuring filters
- 🧪 **Live Network Tester** — Preview which files will be allowed/blocked before committing to a full extraction
- 📦 **One-Click ZIP Download** — All captured resources packaged into a clean `.zip` archive
- 🚦 **Job Queue** — Run multiple extractions with rate-limiting (max 4 concurrent downloads)
- 💾 **SQLite Persistence** — All jobs and resource metadata stored locally

---

## 🖥️ Screenshots

> *Step 1: Enter target URL + Live browser preview*

> *Step 2: Configure filters with searchable dropdown + Live network tester*

> *Step 3: Download your ZIP*

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + Vite + TypeScript |
| **Styling** | Vanilla CSS (Glassmorphism Dark Theme) |
| **Backend** | Node.js + Fastify + TypeScript |
| **Database** | SQLite via `better-sqlite3` |
| **Browser Engine** | Playwright (Chromium) |
| **Packaging** | `archiver` v8 |
| **Queue** | `p-queue` |

---

## ⚡ Quick Start

### Prerequisites
- Node.js 18+
- npm 9+

### 1. Clone the repository
```bash
git clone https://github.com/Heryakos/Net_Harvest.git
cd Net_Harvest
```

### 2. Install all dependencies
```bash
# Install root dependencies
npm install

# Install backend dependencies
cd backend && npm install

# Install Playwright browser
npx playwright install chromium

# Install frontend dependencies
cd ../frontend && npm install
```

### 3. Run the development server
```bash
# From the root directory — starts both backend AND frontend
cd ..
npm run dev
```

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3000

---

## 📖 How to Use

### Step 1 — Define Target
Enter the URL of any website you want to extract from (e.g. `https://example.com`). The right panel will show a live preview of the site.

### Step 2 — Set Filters
Add filter rules to control which network requests to capture:
- **Include (ALL)** → Only download files matching ALL include rules
- **Exclude (ANY)** → Skip files matching ANY exclude rule

Use the **searchable dropdown** to pick file extensions, or type your own. Click **"Test Rules Live"** to do a dry run and preview what will be captured.

### Step 3 — Download
Click **"▶ Start Extraction Job"** to begin. When complete, click **"📦 Download ZIP Archive"** to get all captured resources.

---

## 🗂️ Project Structure

```
Net_Harvest/
├── backend/
│   └── src/
│       ├── server.ts               # Fastify HTTP server + API routes
│       ├── db/index.ts             # SQLite schema & connection
│       ├── jobs/
│       │   ├── jobModel.ts         # Job CRUD operations
│       │   └── runner.ts           # Job execution with p-queue
│       └── pipeline/
│           ├── extractor/          # Playwright network interception
│           ├── fetcher/            # HTTP resource downloader
│           ├── filter/             # URL filter rule engine
│           └── packager/           # ZIP archive builder
├── frontend/
│   └── src/
│       ├── App.tsx                 # Main UI with step wizard
│       ├── index.css               # Glassmorphism dark theme
│       └── components/
│           └── FilterGuide.tsx     # Filter help panel
├── README.md
├── MANUAL.md                       # Detailed user + developer guide
└── CONTRIBUTING.md
```

---

## 📡 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/ping` | Health check |
| `GET` | `/api/jobs` | List all jobs |
| `POST` | `/api/jobs` | Create & start a new extraction job |
| `GET` | `/api/jobs/:id/download` | Download ZIP of extracted resources |
| `POST` | `/api/preview` | Live preview of filter results |

### POST `/api/jobs` Body
```json
{
  "startUrl": "https://example.com",
  "filters": [
    { "type": "extension", "value": ".png", "isInclude": true },
    { "type": "extension", "value": ".glb", "isInclude": true }
  ]
}
```

---

## ⚠️ Legal & Ethical Use

NetHarvest is designed for:
- ✅ Downloading resources from **websites you own or have permission to access**
- ✅ Archiving your own work and projects
- ✅ Offline browsing of licensed content

**Do not** use NetHarvest to:
- ❌ Scrape copyrighted content without permission
- ❌ Bypass paywalls or DRM
- ❌ Violate a website's Terms of Service

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🙋 Author

**Hiryakos Meles** — [Portfolio](https://hiryakos-portfolio.vercel.app/) · [GitHub](https://github.com/Heryakos)
