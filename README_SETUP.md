# 📖 Project Documentation Index

**Complete setup & reference guides for TrackSense**

Welcome to TrackSense! This folder contains everything your team needs to get up and running.

---

## 🚀 Getting Started (Pick Your Path)

### **I'm completely new — Where do I start?**
→ Read **[SETUP.md](SETUP.md)** (Step-by-step walkthrough)

### **I want quick setup (automate it)**
→ Run the setup script:
- **Windows:** Double-click `setup.bat`
- **Mac/Linux:** Run `bash setup.sh`

### **I want a quick reference (print this!)**
→ See **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** (Cheat sheet)

### **Something's broken — how do I fix it?**
→ Check **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** (Common errors & fixes)

---

## 📚 Documentation Files

| File | Purpose | Best For |
|------|---------|----------|
| **[SETUP.md](SETUP.md)** | Complete step-by-step setup guide | First-time setup, detailed instructions |
| **[.env.example](.env.example)** | Environment variable template | Creating your `.env` file |
| **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** | Commands, URLs, troubleshooting | Quick lookup, printing |
| **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** | Detailed error solutions | Debugging specific errors |
| **setup.bat** | Auto-setup script (Windows) | Automated setup |
| **setup.sh** | Auto-setup script (Mac/Linux) | Automated setup |

---

## ⚡ TL;DR (Very Quick Start)

```bash
# 1. Install dependencies (once)
cd backend && npm install

# 2. Create .env file (once per person)
cp .env.example .env

# 3. Edit .env and change JWT_SECRET, ADMIN_SETUP_KEY

# 4. Start Ollama (every session, separate terminal)
ollama serve

# 5. Start backend (every session)
cd backend && npm start

# 6. Open dashboard
http://localhost:5000/dashboard
```

---

## 🎯 Key Concepts

### **What is this project?**
TrackSense is an analytics tracking platform with AI insights:
- **Tracker**: Embed JavaScript snippet on your website to track user behavior
- **Dashboard**: Web interface to visualize analytics
- **AI**: Ollama-powered insights and recommendations

### **What's Ollama?**
Ollama is a local AI engine that powers the AI features:
- Runs on your machine (not cloud) — private & fast
- Requires ~5-7GB disk for models
- Runs on port 11434

### **What's .env?**
Configuration file with secrets:
- Never commit to git (already in .gitignore)
- Create locally: `cp .env.example .env`
- Each person has their own copy
- Customize for your machine

---

## 📋 Setup Checklist

Print and check off as you complete:

```
PREREQUISITES
☐ Node.js v18+ installed
☐ Git installed
☐ Ollama downloaded

INSTALLATION
☐ Cloned the repository
☐ Ran npm install
☐ Created .env from .env.example
☐ Edited .env (changed JWT_SECRET)

RUNNING
☐ Ollama server started (ollama serve)
☐ Backend server started (npm start)
☐ Dashboard loads (http://localhost:5000/dashboard)

ADMIN SETUP
☐ Created first admin user (/auth/setup)
☐ Can login to dashboard

TESTING
☐ Created test project
☐ Embedded tracker code
☐ Generated events
☐ AI features working (requires Ollama)
```

---

## 🛠️ Common Commands

```bash
# Setup (one time)
npm install
cp .env.example .env

# Daily development (two terminals)
Terminal 1: ollama serve
Terminal 2: cd backend && npm start

# Debugging
http://localhost:5000/health              # Backend health
curl http://localhost:11434/api/tags      # Ollama check
http://localhost:5000/dashboard           # Dashboard access

# Management
npm run dev                                # Watch mode (auto-restart)
Ctrl+C                                     # Stop server
```

---

## 🤖 Ollama Setup (Step-by-Step)

```bash
# 1. Install Ollama
# Download from https://ollama.ai/download

# 2. Pull a model (takes time, ~7GB download)
ollama pull llama3.2        # Recommended
# or
ollama pull llama2          # Lighter, faster

# 3. Verify
ollama list                 # See installed models
ollama serve                # Start server

# 4. Test
curl http://localhost:11434/api/tags  # Should see your models
```

---

## 🚨 Most Common Issues

| Issue | Solution |
|-------|----------|
| **Port 5000 in use** | `taskkill /IM node.exe /F` then `npm start` |
| **Ollama not connecting** | Make sure `ollama serve` is running in another terminal |
| **`.env` not found** | Run: `cp .env.example .env` |
| **Database locked** | Delete `analytics.db`, restart backend |
| **Blank dashboard** | Check browser console (F12), check backend logs |

**More issues?** → See [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

---

## 📁 Project Structure

```
.
├── backend/                    # Node.js/Express server
│   ├── routes/                # API endpoints
│   ├── services/              # Business logic
│   ├── middleware/            # Middleware (auth, etc)
│   ├── db/                    # Database layer (SQLite)
│   ├── server.js              # Main server file
│   ├── .env.example           # Environment template
│   ├── .env                   # Your config (created from .env.example)
│   └── package.json           # Dependencies
├── dashboard/                  # Web dashboard (frontend)
│   ├── app.js                # Main dashboard logic
│   ├── index.html            # Dashboard HTML
│   └── style.css             # Dashboard styles
├── tracker/                    # Analytics tracking SDK
│   └── tracker.js            # JS to embed on websites
├── test-site/                 # Example website for testing
├── SETUP.md                   # Start here! 👈
├── QUICK_REFERENCE.md         # Cheat sheet
├── TROUBLESHOOTING.md         # Error solutions
├── setup.bat                  # Auto-setup (Windows)
└── setup.sh                   # Auto-setup (Mac/Linux)
```

---

## 👥 For Team Members

**Onboarding a new member?**

1. **Send them this folder** (or GitHub link)
2. **Say:** "Start with SETUP.md"
3. **They should run:**
   - `setup.bat` (Windows) or `bash setup.sh` (Mac/Linux)
   - Edit `.env` with their JWT_SECRET
   - Follow steps 4-6 in TL;DR section
4. Done! 🎉

---

## 🔐 Security Reminders

- ✅ `.env` is in `.gitignore` (never commits secrets)
- ✅ Share `.env.example` not `.env`
- ✅ Change `JWT_SECRET` and `ADMIN_SETUP_KEY` in `.env` **immediately**
- ✅ Use strong random values (32+ characters)
- ✅ Don't share secrets in chat — each person creates their own `.env`

---

## 📞 Getting Help

1. **Check the docs:**
   - SETUP.md (if setup issue)
   - TROUBLESHOOTING.md (if error)
   - QUICK_REFERENCE.md (if need command)

2. **Debug:**
   - Check terminal for error messages
   - Verify Ollama is running
   - Verify backend is running
   - Clear browser cache

3. **Ask team:**
   - Share error message
   - Share what you were doing
   - Share OS & tool versions

---

## 📖 Additional Resources

- **Ollama Docs:** https://ollama.ai
- **Express.js Docs:** http://expressjs.com
- **SQLite Docs:** https://www.sqlite.org
- **JWT Docs:** https://jwt.io

---

## ✅ You're Ready!

You now have everything needed to:
- ✅ Set up the project locally
- ✅ Start the backend & Ollama
- ✅ Access the dashboard
- ✅ Create analytics projects
- ✅ Generate AI insights
- ✅ Debug issues

**Next step:** Pick your starting guide above and get started! 🚀

---

**Questions?** Check the folder above — there's a guide for everything!

