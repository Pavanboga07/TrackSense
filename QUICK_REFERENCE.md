# 🚀 TrackSense - Quick Reference Card

**Print this for your desk or save to phone!**

---

## ⚡ Commands to Know

```bash
# START OLLAMA (in separate terminal)
ollama serve

# START BACKEND
cd backend
npm start          # or npm run dev (watch mode)

# STOP SERVER
Ctrl+C

# GET DASHBOARD
http://localhost:5000/dashboard

# HEALTH CHECK
http://localhost:5000/health
```

---

## 🛠️ Troubleshooting in 30 Seconds

| Problem | Fix |
|---------|-----|
| **"Cannot connect to Ollama"** | Run `ollama serve` in another terminal |
| **"Port 5000 in use"** | `taskkill /IM node.exe /F` (Windows) or `killall node` (Mac/Linux) |
| **"Module not found"** | Run `npm install` in backend folder |
| **"Database locked"** | Stop server, delete `analytics.db`, restart |
| **Page is slow** | First AI request is slow (normal!). Subsequent requests faster. |
| **"ENOENT: no such file"** | Check `.env` exists. Copy: `cp .env.example .env` |

---

## 📊 Key URLs

```
Backend health:        http://localhost:5000/health
Dashboard:             http://localhost:5000/dashboard
Admin setup (once):    http://localhost:5000/auth/setup?adminKey=YOUR_KEY
Tracker test:          http://localhost:5000/tracker.js
API docs:              See backend/routes/
```

---

## 🎯 First Time Setup

```bash
1. npm install                  # One time
2. cp .env.example .env         # One time
3. Edit .env (JWT_SECRET, etc)  # One time
4. ollama serve                 # Every session (another terminal)
5. npm start                    # Every session
6. Open http://localhost:5000/dashboard
```

---

## 🧠 Ollama Cheat Sheet

```bash
ollama list                 # See installed models
ollama pull llama3.2        # Download model (7-10GB, takes time)
ollama show llama3.2        # Show model details
ollama serve                # Start server (port 11434)

# Test it's working:
curl http://localhost:11434/api/tags
```

---

## 🤔 .env Variables Explained

| Variable | What It Does | Example |
|----------|--------------|---------|
| `PORT` | Server port | `5000` |
| `JWT_SECRET` | Auth token key | `abc123xyz...` (random) |
| `ADMIN_SETUP_KEY` | First admin creation | `setup123...` (random) |
| `OLLAMA_URL` | AI server location | `http://localhost:11434` |
| `OLLAMA_MODEL` | AI model to use | `llama3.2` |
| `ALLOWED_ORIGINS` | CORS domains | `*` (dev) or specific domains |
| `DB_PATH` | Database file | `./analytics.db` |

---

## 📱 For Teammates

**Share this checklist to get them running:**

```
☐ Install Node.js & Git
☐ Clone repo
☐ Run: npm install (in backend folder)
☐ Copy: .env.example → .env
☐ Edit .env (change JWT_SECRET & ADMIN_SETUP_KEY)
☐ Install & run Ollama
☐ Run: npm start
☐ Visit: http://localhost:5000/dashboard
☐ Create admin user via /auth/setup
☐ Create a test project
☐ Embed tracker code in test website
☐ Generate events & check dashboard
☐ Try AI Insights (requires Ollama running)
```

---

## 📞 Common Questions

**Q: Do I need to recreate `.env` every time?**
A: No — create once, keep it. It's in `.gitignore`.

**Q: Can I run Ollama on a different machine?**
A: Yes! Update `.env`: `OLLAMA_URL=http://[ip-address]:11434`

**Q: What if Ollama is too slow?**
A: Use smaller model: Change `.env`: `OLLAMA_MODEL=llama2`

**Q: How do I share my `.env` with teammates?**
A: Don't! They make their own `.env`. You only share `.env.example`.

**Q: Can I use a different AI model?**
A: Yes! Run `ollama pull [model-name]`, then update `.env`

---

## 🐛 Debug Mode

```bash
# Windows PowerShell - verbose logging
$env:DEBUG="*" ; npm start

# Mac/Linux - verbose logging
DEBUG=* npm start

# Just see if database queries work
curl -X POST http://localhost:5000/events \
  -H "Content-Type: application/json" \
  -d '{"projectId":"test","event":"page_view","page":"/"}'
```

---

## ✅ Healthy Signs

When everything works, you'll see:
- ✅ `Server listening on Port 5000`
- ✅ `http://localhost:5000/health` returns `{"status":"ok"}`
- ✅ Dashboard loads at `http://localhost:5000/dashboard`
- ✅ Ollama shows: `Listening on 127.0.0.1:11434`
- ✅ AI features respond when Ollama is running

---

**📖 Full setup guide:** See `SETUP.md`  
**🛠️ Auto setup script:** Windows → `setup.bat` | Mac/Linux → `setup.sh`

