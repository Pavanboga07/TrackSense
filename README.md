# 🚀 TrackSense — AI-Powered Web Analytics & UX Intelligence

> **TrackSense** (StartupInsight AI) is an open-source, privacy-first, lightweight, multi-tenant web analytics and user experience (UX) intelligence platform with built-in AI analytics powered by local LLMs via **Ollama**.

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [Technology Stack](#-technology-stack)
- [How It Works](#-how-it-works)
- [Repository Structure](#-repository-structure)
- [Setup & Installation](#-setup--installation)
  - [Prerequisites](#prerequisites)
  - [Option 1: Quick Automated Setup](#option-1-quick-automated-setup-recommended)
  - [Option 2: Manual Setup](#option-2-manual-setup)
- [Usage Guide](#-usage-guide)
  - [1. First-Time Admin Setup](#1-first-time-admin-setup)
  - [2. Creating a Project](#2-creating-a-project)
  - [3. Embedding tracker.js](#3-embedding-trackerjs)
- [API Reference](#-api-reference)
  - [Public & SDK Endpoints](#public--sdk-endpoints)
  - [Dashboard & Admin Endpoints](#dashboard--admin-endpoints)
  - [AI Endpoints](#ai-endpoints)
- [Documentation & Helpful Links](#-documentation--helpful-links)
- [License](#-license)

---

## 💡 Overview

**TrackSense** provides modern web product analytics without external third-party data collection or heavy tracking scripts. It bridges the gap between raw behavioral event collection (pageviews, clicks, scroll depth, rage clicks, form abandonment, JS errors) and automated AI-driven product insights.

By utilizing **Ollama**, TrackSense runs powerful Large Language Models (e.g., `Llama 3.2`, `Mistral`) **entirely locally on your machine**, giving product teams actionable UX insights, friction analysis, and natural language analytics Q&A with zero data leakage.

---

## ✨ Key Features

- ⚡ **Zero-Dependency Tracker SDK (`tracker.js`)**: Ultra-lightweight (~10KB), non-blocking tracking script with auto-capture for page views, click elements, CSS paths, scroll milestones (25%, 50%, 75%), rage clicks, form abandonment, video playback, text copying, tab visibility, and JavaScript errors.
- 🤖 **Local AI Insights (Ollama)**: Local LLM integration generating plain-English executive summaries, page-by-page friction diagnosis, single-session user journey narration, and natural language data querying without third-party cloud AI costs.
- 🏢 **Multi-Tenant SaaS Backend**: Multi-project management with secure API keys (`pk_live_...`), JWT authentication, tenant data isolation, and rate-limiting middleware.
- 🎯 **Goals & Conversion Funnel Analytics**: Define custom multi-step funnels, measure drop-off rates across user paths, and track conversion goals.
- 💥 **UX Friction & Rage Click Detector**: Automatic detection of frustrated users, rage clicks (multiple rapid clicks within a small radius), form drop-offs, and broken page interactions.
- 🔍 **SEO & Sitemap Auditor**: Automatic HTML metadata inspection, missing title/H1 tags check, and sitemap crawling to evaluate SEO health.
- 📊 **Interactive Dashboard**: Modern, dark-themed responsive single-page web app with real-time stats, time-series charts, country distribution, device breakdowns, heatmaps, and streaming AI assistant.

---

## 🏗️ System Architecture

```
                          ┌─────────────────────────┐
                          │    Tracked Website      │
                          │ (HTML + tracker.js SDK) │
                          └────────────┬────────────┘
                                       │ HTTP POST /track (batched JSON)
                                       ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                            TrackSense Backend                            │
 │                        (Node.js + Express Server)                        │
 │  ┌─────────────────┬───────────────────┬───────────────┬──────────────┐  │
 │  │  Auth & Users   │ Projects & Keys   │ Track & Events│ Funnels/Goals│  │
 │  ├─────────────────┼───────────────────┼───────────────┼──────────────┤  │
 │  │ Friction & Heat │ SEO Audit Engine  │  Admin API    │ AI Controller│  │
 │  └────────┬────────┴─────────┬─────────┴───────┬───────┴──────┬───────┘  │
 └───────────┼──────────────────┼─────────────────┼──────────────┼──────────┘
             │                  │                 │              │
             ▼                  ▼                 ▼              ▼
   ┌───────────────────┐               ┌───────────────────┐    ┌─────────────────┐
   │ SQLite DB (WASM)  │               │   Web Dashboard   │    │ Ollama AI Engine│
   │ (sql.js / WASM)   │               │ (Vanilla HTML/JS/ │    │(Local LLM Port  │
   │ analytics.db      │               │  Tailwind/Chart)  │    │     11434)      │
   └───────────────────┘               └───────────────────┘    └─────────────────┘
```

---

## 🛠️ Technology Stack

| Layer | Technology | Description |
|-------|------------|-------------|
| **Tracker SDK** | Vanilla JavaScript (ES5+) | Lightweight (~10KB), zero-dependency client script auto-capturing user events, DOM CSS paths, scroll depth, rage clicks, and session journeys. |
| **Backend Engine** | Node.js (v18+) & Express.js | High-performance RESTful API, static SDK server, and middleware stack. |
| **Database Layer** | SQLite via `sql.js` (WASM) | Embedded relational database with WASM execution, structured SQL migrations (`001_init.sql`, `002_features.sql`), and compound indexes (`project_id`, `timestamp`). |
| **AI / LLM Engine** | Ollama (`llama3.2` / `mistral`) | Local LLM server running on port `11434`, streaming insights via Server-Sent Events (SSE) `/api/generate` and `/api/chat`. |
| **Security & Auth** | JWT (`jsonwebtoken`), `bcryptjs`, `helmet`, `cors`, `express-rate-limit` | Password hashing, token security, CORS origin isolation, security headers, rate limiting. |
| **Frontend UI** | HTML5, CSS3, Vanilla JS (ES6+), FontAwesome, Chart.js / ApexCharts | Single-page admin dashboard for monitoring real-time metrics, project administration, AI interactions, heatmaps, and funnel visualizations. |

---

## ⚙️ How It Works

1. **Event Capture (`tracker.js`)**
   - The embedded SDK attaches lightweight event listeners to window and document events.
   - It captures element tags, IDs, unique CSS selector paths (`css_path`), click coordinates `(x, y)`, scroll milestones, and form interactions.
   - Events are buffered in memory and batched to `POST /track` every **3 seconds** (or upon page exit using `navigator.sendBeacon`).

2. **Backend Ingestion & Multi-Tenant Processing (`backend/`)**
   - The backend validates the project API key (`pk_live_...`) and enriches each event with client IP, user agent, and ISO timestamps.
   - Events are saved into SQLite under `events` table, strictly isolated by `project_id`.

3. **Analytics Aggregation & UX Processing**
   - The backend computes session journeys, conversion funnel step completions, rage click counts, and high-friction exit pages.

4. **Local AI Reasoning (Ollama)**
   - When requested from the dashboard, TrackSense compiles structured analytics metrics and sends a prompt to Ollama's local LLM (`http://localhost:11434`).
   - The LLM streams plain-English recommendations and diagnoses back to the dashboard UI in real time.

---

## 📁 Repository Structure

```
.
├── backend/                  # Node.js + Express REST API & Database
│   ├── db/                   # Database initialization & WASM SQLite setup
│   │   ├── migrations/       # SQL schema files (001_init.sql, 002_features.sql)
│   │   └── index.js          # Database connector (sql.js)
│   ├── middleware/           # Auth (JWT), API Key validation, Rate limiting
│   ├── routes/               # API route handlers (ai, auth, events, friction, funnels, goals, etc.)
│   ├── services/             # Business logic (authService, eventService, projectService)
│   ├── server.js             # Main server entrypoint
│   └── package.json          # Node dependencies
├── dashboard/                # Analytics Web UI (Frontend)
│   ├── index.html            # Dashboard structure & views
│   ├── app.js                # Single-page app logic & API calls
│   └── style.css             # Dashboard styling
├── tracker/                  # Client-side analytics tracker SDK
│   └── tracker.js            # Standalone zero-dependency tracking SDK
├── test-site/                # Sample test application
│   └── index.html            # Interactive test page with tracker embedded
├── FLOWCHART.md              # Visual setup & workflow diagrams
├── QUICK_REFERENCE.md        # Command cheat sheet & quick fixes
├── README_SETUP.md           # Setup instructions summary
├── SETUP.md                  # Detailed setup guide
├── TROUBLESHOOTING.md        # Troubleshooting & common errors guide
├── setup.bat                 # One-click Windows setup batch script
└── setup.sh                  # One-click macOS / Linux setup script
```

---

## 🚀 Setup & Installation

### Prerequisites

- **Node.js**: v18.0.0 or higher ([Download](https://nodejs.org/))
- **Git**: Installed on your system
- **Ollama**: Required for local AI features ([Download](https://ollama.ai/download))

---

### Option 1: Quick Automated Setup (Recommended)

#### **On Windows:**
Double-click `setup.bat` or run in PowerShell:
```cmd
.\setup.bat
```

#### **On macOS / Linux:**
```bash
chmod +x setup.sh
./setup.sh
```

---

### Option 2: Manual Setup

#### **Step 1: Clone & Install Dependencies**
```bash
git clone <repo-url>
cd "Mumbai hackathon"
cd backend
npm install
cd ..
```

#### **Step 2: Set Up Ollama AI Server**
1. Download & install Ollama from [ollama.ai/download](https://ollama.ai/download).
2. Open a **new terminal window** and pull the default model:
   ```bash
   ollama pull llama3.2
   ```
3. Start the Ollama server:
   ```bash
   ollama serve
   ```
   *(Keep this terminal open! Ollama runs on `http://localhost:11434`)*

#### **Step 3: Configure Environment Variables**
In the `backend/` directory, copy `.env.example` to `.env`:
```bash
cd backend
cp .env.example .env
```
Edit `.env` and set secure keys:
```env
PORT=5000
ALLOWED_ORIGINS=*
JWT_SECRET=your-secure-random-32-char-secret
ADMIN_SETUP_KEY=your-admin-setup-key
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

#### **Step 4: Start the Backend Server**
In your main terminal window:
```bash
cd backend
npm start
```
*For automatic server reload during development:*
```bash
npm run dev
```

---

## 💻 Usage Guide

### 1. First-Time Admin Setup
1. Open your browser and navigate to `http://localhost:5000/dashboard`.
2. To create the first admin user, visit:
   `http://localhost:5000/auth/setup?adminKey=YOUR_ADMIN_SETUP_KEY`
3. Enter your email and password to complete admin registration.

### 2. Creating a Project
1. Log in to the dashboard.
2. Click **"New Project"**.
3. Enter your Website Name and Domain.
4. Copy the generated **Project API Key** (e.g. `pk_live_12345...`).

### 3. Embedding tracker.js
Include the tracker snippet in the `<head>` of your website:

```html
<script>
  window.SI_PROJECT_KEY = 'pk_live_YOUR_API_KEY_HERE';
  window.SI_ENDPOINT    = 'http://localhost:5000/track';
</script>
<script src="http://localhost:5000/tracker.js"></script>
```

#### HTML Attribute-Based Tracking (Zero JS Code):
```html
<!-- Track conversion goals on button clicks -->
<button data-si-goal="signup_clicked" data-si-goal-value="10">Sign Up</button>

<!-- Track element visibility when scrolled into view -->
<div data-si-track="pricing_section">Pricing Plans</div>
```

#### JavaScript API Examples:
```javascript
// Track custom events
SI.track('added_to_cart', { item: 'Pro Plan', price: 49 });

// Identify logged-in users
SI.identify('user_9876', { email: 'alex@example.com', plan: 'pro' });

// Set A/B Testing Variant
SI.setVariant('landing_page_experiment', 'Variant_B');

// Force-flush event queue
SI.flush();
```

---

## 📡 API Reference

### Public & SDK Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/health` | Server and database health check | Public |
| `GET` | `/tracker.js` | Serves client analytics tracker JavaScript SDK | Public |
| `POST` | `/track` | Ingests batched client analytics events | Project Key (`SI_PROJECT_KEY`) |

### Dashboard & Admin Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/auth/login` | Authenticate user & return JWT token | Public |
| `GET` | `/auth/setup` | Create initial admin user account | Admin Setup Key |
| `GET` | `/projects` | Get all projects owned by tenant | Bearer JWT |
| `POST` | `/projects` | Create a new tracked project | Bearer JWT |
| `GET` | `/events` | Query raw analytics events for a project | Bearer JWT |
| `GET` | `/events/stats` | Retrieve aggregated event metrics & charts | Bearer JWT |
| `GET` | `/goals` | List configured project goals | Bearer JWT |
| `POST` | `/goals` | Create a conversion goal | Bearer JWT |
| `GET` | `/funnels` | Retrieve funnels & conversion step progress | Bearer JWT |
| `GET` | `/heatmap` | Aggregate click coordinate heatmaps | Bearer JWT |
| `GET` | `/friction` | High-friction pages & rage click data | Bearer JWT |
| `GET` | `/seo/audit` | Automated website SEO audit | Bearer JWT |

### AI Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/ai/insights` | Generates plain-English overall analytics summary | Bearer JWT + Ollama |
| `POST` | `/ai/friction` | Root-cause diagnosis per high-friction page | Bearer JWT + Ollama |
| `POST` | `/ai/session-summary` | Narrates a single user session journey | Bearer JWT + Ollama |
| `POST` | `/ai/query` | Answers freeform user questions about data | Bearer JWT + Ollama |

---

## 📚 Documentation & Helpful Links

- 📖 **Detailed Setup Walkthrough**: See [SETUP.md](file:///c:/Users/onkar/Desktop/Mumbai%20hackathon/SETUP.md)
- 📊 **Visual Flowcharts & Terminal Diagram**: See [FLOWCHART.md](file:///c:/Users/onkar/Desktop/Mumbai%20hackathon/FLOWCHART.md)
- ⚡ **Command Cheat Sheet**: See [QUICK_REFERENCE.md](file:///c:/Users/onkar/Desktop/Mumbai%20hackathon/QUICK_REFERENCE.md)
- 🛠️ **Troubleshooting Guide**: See [TROUBLESHOOTING.md](file:///c:/Users/onkar/Desktop/Mumbai%20hackathon/TROUBLESHOOTING.md)

---

## 📄 License

Distributed under the **MIT License**.
