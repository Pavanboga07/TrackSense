# 🚀 Project Setup Guide for Teammates

Welcome! This guide helps you set up **TrackSense** (Analytics Tracking + AI) on your local machine. Follow these steps exactly.

---

## 📋 Prerequisites

Before starting, make sure you have:
- **Node.js** (v18 or higher) — [Download](https://nodejs.org/)
- **Git** installed
- **Ollama** installed for AI features — [Download](https://ollama.ai/download)
- A terminal/command prompt (PowerShell on Windows)

**Check your versions:**
```bash
node --version   # Should be v18+
npm --version
git --version
```

---

## 🎯 Step 1: Clone & Install Dependencies

1. **Clone the repository** (or pull if already cloned):
```bash
cd "c:\Users\[YourUsername]\Desktop"
git clone <repo-url>  # or git pull if already there
cd "Mumbai hackathon"
```

2. **Install backend dependencies:**
```bash
cd backend
npm install
cd ..
```

3. **No frontend setup needed** — Dashboard runs in the browser.

---

## 🤖 Step 2: Set Up Ollama (For AI Features)

Ollama provides the AI engine for insights, recommendations, and data analysis.

### **2.1 Install Ollama**

1. **Download & Install** from [ollama.ai/download](https://ollama.ai/download)
2. **Verify installation:**
```bash
ollama --version
```

### **2.2 Pull a Model**

Ollama requires a model to generate AI insights. Run:

```bash
# Pull the default model (llama3.2 - 8B, balanced performance)
ollama pull llama3.2
```

**Model options** (smaller = faster, larger = better quality):
- `ollama pull llama3.2` ← **Recommended for hackathon** (8B, ~5GB)
- `ollama pull llama2` (7B, ~4GB, lightweight)
- `ollama pull mistral` (7B, good for instruction-following)

This downloads ~5-7GB, so give it time. ☕

### **2.3 Start Ollama Server**

Open a **new terminal** and start Ollama:
```bash
ollama serve
```

You should see:
```
Listening on 127.0.0.1:11434
```

**Keep this terminal open!** The server must run for AI features to work.

**Check it's running:**
```bash
# In another terminal
curl http://localhost:11434/api/tags
```

---

## ⚙️ Step 3: Configure Environment Variables

1. **Copy the template:**
```bash
cd backend
cp .env.example .env
```

2. **Edit `.env`** file (use VS Code or any text editor):

```env
PORT=5000
ALLOWED_ORIGINS=*

# ⚠️ CHANGE THESE for security:
JWT_SECRET=your-secure-random-string-here
ADMIN_SETUP_KEY=your-admin-setup-key-here

# Ollama config (update if running on different machine)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

**Generate secure keys** (PowerShell):
```powershell
# For JWT_SECRET:
-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | % {[char]$_})

# For ADMIN_SETUP_KEY:
-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | % {[char]$_})
```

Or just use: `abc123xyz789abc123xyz789abc123xyz789abcd` (for development only!)

---

## 🏃 Step 4: Start the Backend Server

```bash
cd backend
npm start
```

You should see:
```
Server listening on Port 5000
✓ Database ready
✓ Auth service ready
```

### **Verify it's running:**

Open browser: http://localhost:5000/health

You should see:
```json
{ "status": "ok", "timestamp": "..." }
```

---

## 📊 Step 5: Access the Dashboard

1. **Open browser:** http://localhost:5000/dashboard
2. **Create first admin user** (only shown once):
   - Visit: http://localhost:5000/auth/setup?adminKey=[YOUR_ADMIN_SETUP_KEY]
   - Set email & password
   - Click "Create Admin"

3. **Login** with your credentials

---

## 🧪 Step 6: Test the App

### **Create a test website:**
1. Log in to dashboard
2. Create → New Project
3. Copy the tracking code snippet
4. Embed in `test-site/index.html` or any HTML file

### **Generate test data:**
1. Visit your website (opens in browser)
2. Click around, scroll, interact
3. Wait 2-3 seconds
4. Refresh dashboard → See data appear

### **Try AI features:**
1. Go to **AI Insights** section
2. Click "Get Insights"
3. AI will analyze your data and provide recommendations

---

## 🛠️ Troubleshooting

### **Issue: "Cannot connect to Ollama"**
```
Error: fetch failed (http://localhost:11434)
```
**Fix:**
1. Check Ollama server is running in another terminal
2. Verify: `curl http://localhost:11434/api/tags`
3. If on different machine, update `.env`: `OLLAMA_URL=http://[machine-ip]:11434`

### **Issue: "Port 5000 already in use"**
```
Error: listen EADDRINUSE: address already in use :::5000
```
**Fix:**
```bash
# Windows: Kill the process
Get-Process -Name "node" | Stop-Process -Force
# Then restart: npm start
```

### **Issue: "Out of memory" when pulling Ollama model**
**Fix:**
- Close other applications
- Use smaller model: `ollama pull llama2` (instead of llama3.2)

### **Issue: "Database is locked"**
```
Error: database is locked
```
**Fix:**
1. Stop the server (Ctrl+C)
2. Delete `backend/analytics.db`
3. Restart server

### **Issue: AI responses are slow**
**Reason:** First request trains the model (normal!)
**Solution:** Use lighter model in `.env`: `OLLAMA_MODEL=llama2`

---

## 📱 Share Your Setup with Teammates

1. **Create `.env` from `.env.example`** (already done in Step 3)
2. **All teammates can:**
   ```bash
   git clone <repo>
   cd backend && npm install
   cp .env.example .env
   # Edit .env with their own JWT_SECRET
   npm start
   ```
3. **Ollama setup is per-machine** — Each teammate needs to run `ollama serve`

---

## 📚 Key Files to Know

| File/Folder | Purpose |
|---|---|
| `backend/server.js` | Main backend server |
| `backend/routes/` | API endpoints (analytics, AI, auth, etc.) |
| `backend/.env` | Your local environment configuration |
| `dashboard/app.js` | Frontend dashboard logic |
| `dashboard/index.html` | Dashboard HTML |
| `tracker/tracker.js` | Analytics tracking SDK (embed in websites) |

---

## 🎓 Common Commands

```bash
# Start backend
cd backend && npm start

# Start backend in watch mode (auto-restart on code changes)
cd backend && npm run dev

# Start Ollama server
ollama serve

# List available Ollama models
ollama list

# Pull a new Ollama model
ollama pull [model-name]

# Stop server
# Press Ctrl+C in the terminal
```

---

## ✅ Checklist Before You're Done

- [ ] Node.js v18+ installed
- [ ] Git clone successful
- [ ] `npm install` completed
- [ ] Ollama server running (`ollama serve`)
- [ ] `.env` file created and configured
- [ ] Backend server running (`npm start`)
- [ ] Dashboard accessible at `http://localhost:5000/dashboard`
- [ ] Admin user created via `/auth/setup`
- [ ] Can create a project in dashboard
- [ ] AI insights responding when Ollama is running

---

## 🆘 Still Stuck?

1. **Check logs** — Look at exact error messages
2. **Verify Ollama** — Run: `curl http://localhost:11434/api/tags`
3. **Check ports** — Make sure 5000 (backend) and 11434 (Ollama) aren't blocked
4. **Ask team** — Share error in team chat

**Happy tracking! 🚀**
