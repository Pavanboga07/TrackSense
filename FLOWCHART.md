# 🎯 Setup Flowchart & Checklist

Visual guide for getting teammates up and running.

---

## 📊 Setup Flow Diagram

```
START
  │
  ├─→ Have Node.js v18+? ──NO──→ [Install from nodejs.org]
  │     │
  │    YES
  │     │
  ├─→ Have Ollama? ──NO──→ [Install from ollama.ai/download]
  │     │
  │    YES
  │     │
  ├─→ Clone/Pull repo
  │     │
  ├─→ npm install (in backend folder)
  │     │
  ├─→ cp .env.example .env
  │     │
  ├─→ Edit .env file
  │   ├─ Change JWT_SECRET (random 32 chars)
  │   └─ Change ADMIN_SETUP_KEY (random 32 chars)
  │     │
  ├─→ Terminal 1: ollama serve
  │   (Keep running!)
  │     │
  ├─→ Terminal 2: cd backend && npm start
  │   (Keep running!)
  │     │
  ├─→ Browser: http://localhost:5000/dashboard
  │     │
  ├─→ Create admin user via /auth/setup
  │     │
  ├─→ Create test project
  │     │
  └─→ ✅ DONE!
```

---

## 🚦 Traffic Light Status

### ✅ GREEN — Everything Works

```
☐ Ollama running → http://localhost:11434/api/tags (responds)
☐ Backend running → http://localhost:5000/health (returns ok)
☐ Dashboard loads → http://localhost:5000/dashboard (no errors)
☐ .env exists → Check backend folder
☐ Admin created → Can login to dashboard
```

### 🟡 YELLOW — Something Needs Attention

```
☐ Dashboard shows "No data" → Generate test events (normal for new projects)
☐ AI insights slow → First request takes 5-15 seconds (normal!)
☐ No error but pages blank → Clear browser cache (Ctrl+Shift+Delete)
☐ Node modules error → Run npm install again
```

### 🔴 RED — Something's Broken

```
☐ Port 5000 in use → taskkill /IM node.exe /F
☐ Cannot connect to Ollama → Check ollama serve is running
☐ .env not found → cp .env.example .env
☐ Database locked → Stop backend, delete analytics.db, restart
☐ Module not found → npm install
```

---

## 📋 Pre-Flight Checklist

**Before asking for help, go through this:**

- [ ] `node --version` returns v18+
- [ ] `npm --version` returns 8+
- [ ] `ollama list` shows at least one model
- [ ] `ollama serve` is running in one terminal (port 11434)
- [ ] `npm start` is running in another terminal (port 5000)
- [ ] `backend/.env` exists (not .env.example)
- [ ] `.env` has unique JWT_SECRET and ADMIN_SETUP_KEY
- [ ] `curl http://localhost:5000/health` returns JSON
- [ ] Dashboard loads at `http://localhost:5000/dashboard`
- [ ] Can login with admin credentials
- [ ] No red errors in browser console (F12)
- [ ] No red errors in backend terminal

If all ✓ → **You're good!**  
If any ✗ → Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## 🎓 Understanding the Terminal Setup

### Why Two Terminals?

```
TERMINAL 1: Ollama Server
└─→ ollama serve
    Port: 11434
    Job: Provide AI models
    Keep running: YES
    Can close: Last (stop AI features)

TERMINAL 2: Backend Server
└─→ cd backend && npm start
    Port: 5000
    Job: API & dashboard
    Keep running: YES
    Can close: Anytime (stop backend)
```

**Visual:**
```
┌──────────────────────────────────────────────────────┐
│ Your Computer                                        │
├──────────────────────────────────────────────────────┤
│                                                      │
│ TERMINAL 1          TERMINAL 2         BROWSER      │
│ ──────────          ──────────         ───────      │
│ ollama serve        npm start      http://localhost │
│    ↓                   ↓                   ↓         │
│ Port 11434          Port 5000      http://localhost │
│ (AI models)      (API + Dashboard)  :5000/dashboard │
│                                                      │
│  ──────────────────────────────────────────────────  │
│           Connected via network (localhost)         │
│  ──────────────────────────────────────────────────  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## 🔄 Daily Workflow

### Every Time You Start Work:

```
1. Open TERMINAL 1:
   $ ollama serve
   (Wait for → "Listening on 127.0.0.1:11434")

2. Open TERMINAL 2:
   $ cd backend
   $ npm start
   (Wait for → "Server listening on Port 5000")

3. Open Browser:
   http://localhost:5000/dashboard

4. Work normally!

5. When done:
   - Ctrl+C in both terminals
   - Close browser tabs
```

### Alternative (Watch Mode for Developers):

```
Terminal 1: ollama serve
Terminal 2: cd backend && npm run dev
(Restarts on file changes automatically)
```

---

## 🛠️ Customization Points

For advanced users who want to customize:

| What | Where | How |
|------|-------|-----|
| **Change port** | `.env` | `PORT=3000` |
| **Use different AI model** | `.env` | `OLLAMA_MODEL=mistral` |
| **Ollama on another PC** | `.env` | `OLLAMA_URL=http://192.168.x.x:11434` |
| **Allow specific origins** | `.env` | `ALLOWED_ORIGINS=https://mysite.com` |
| **Change database location** | `.env` | `DB_PATH=/path/to/db` |

**Remember:** Don't commit `.env` changes (already in .gitignore)

---

## 🧠 Mental Model

```
What the user sees:
    ↓
Browser → Dashboard (http://localhost:5000)
    ↓
Backend API (Node.js on Port 5000)
    ↓ (asks for AI analysis)
Ollama Server (Port 11434)
    ↓
AI Response
    ↓
Display in Dashboard
```

**In simple terms:**
- Dashboard = Website
- Backend = Server that powers the website
- Ollama = AI engine that powers recommendations

All three must be running for full features!

---

## 🎯 Success Indicators

### You're set up correctly if:

✅ Terminal 1 shows:
```
Listening on 127.0.0.1:11434
```

✅ Terminal 2 shows:
```
Server listening on Port 5000
✓ Database ready
```

✅ Browser shows:
```
Dashboard loads without errors
Login works
Can create projects
```

✅ Creating test events works:
```
Embed tracker code → User clicks → Dashboard shows data
```

✅ AI features respond:
```
Click "Get Insights" → Response appears (5-15 seconds)
```

---

## 🚨 Emergency Commands

**Everything broken? Nuclear option:**

```bash
# Kill everything
taskkill /IM node.exe /F         # Windows
killall node ollama               # Mac/Linux

# Delete database (fresh start)
cd backend
del analytics.db                  # Windows
rm analytics.db                   # Mac/Linux

# Clear npm cache
npm cache clean --force

# Reinstall
rm -rf node_modules  OR  rmdir /s /q node_modules
npm install

# Start fresh
ollama serve                      # Terminal 1
npm start                         # Terminal 2
```

---

## 📞 Call for Help Template

When asking team for help, provide:

```
Platform: Windows / Mac / Linux
Error: [Copy-paste exact error message]
What you were doing: [Describe action]
Terminals running: ollama serve? YES/NO | npm start? YES/NO

Steps taken:
1. ___
2. ___
3. ___

Current state:
- ollama serve status: ✓/✗
- npm start status: ✓/✗
- Dashboard loads: ✓/✗
- Database exists: ✓/✗
- .env exists: ✓/✗
```

---

## 📚 Quick Links

- **New to everything?** → Start with [SETUP.md](SETUP.md)
- **Quick commands?** → [QUICK_REFERENCE.md](QUICK_REFERENCE.md)
- **Got an error?** → [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- **Auto-setup?** → Run `setup.bat` (Windows) or `bash setup.sh` (Mac/Linux)
- **Config template?** → [.env.example](.env.example)

---

**Print this page and keep it handy!** 📄

