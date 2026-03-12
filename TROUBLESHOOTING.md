# 🔧 Troubleshooting Guide

Got an error? Find it below!

---

## Network & Port Issues

### ❌ "Port 5000 already in use" or "EADDRINUSE"

**Error:**
```
Error: listen EADDRINUSE: address already in use :::5000
```

**Why:** Another process is using port 5000

**Fix (Windows PowerShell):**
```powershell
# Kill the existing node process
Get-Process -Name "node" | Stop-Process -Force

# Then restart
cd backend
npm start
```

**Fix (Mac/Linux):**
```bash
# Kill the process
killall node

# Or find and kill specific port
lsof -i :5000
kill -9 <PID>

# Then restart
cd backend
npm start
```

**Prevent:** Stop the previous server before starting a new one (Ctrl+C in terminal).

---

### ❌ "Cannot connect to Ollama" or "fetch failed"

**Error:**
```
Error: fetch failed (http://localhost:11434/api/generate)
Error: Cannot contact Ollama server
```

**Why:** Ollama server isn't running

**Fix:**
1. **Open a NEW terminal** (don't use your backend terminal)
2. **Start Ollama:**
   ```bash
   ollama serve
   ```
3. **Verify it's working:**
   ```bash
   curl http://localhost:11434/api/tags
   ```
   You should see a list of models

4. **Retry AI feature** in dashboard

**Keep in mind:**
- You MUST have **two terminals running**:
  - Terminal 1: `ollama serve` (keeps running)
  - Terminal 2: `npm start` (backend)
- AI features only work when both are running
- First AI request is slow (5-15s) — normal!

**Alternative:** If Ollama is on different machine:
1. Find the machine's IP address:
   - Windows: `ipconfig` → IPv4 Address
   - Mac/Linux: `ifconfig` → inet
2. Edit `.env`: `OLLAMA_URL=http://[IP]:11434`
3. Restart backend

---

## Database Issues

### ❌ "database is locked"

**Error:**
```
Error: database is locked
SqliteError: database is locked
```

**Why:** Database file is open elsewhere or corrupted

**Fix:**
1. **Stop the backend:** Ctrl+C in terminal
2. **Delete the database:**
   ```bash
   cd backend
   rm analytics.db  # Mac/Linux
   # OR
   del analytics.db  # Windows
   ```
3. **Restart backend:**
   ```bash
   npm start
   ```

The database rebuilds automatically.

---

### ❌ "ENOENT: no such file or directory './analytics.db'"

**Error:**
```
ENOENT: no such file or directory './analytics.db'
```

**Why:** Database file missing (deleted or wrong path)

**Fix:**
1. Make sure you're in backend folder:
   ```bash
   cd backend
   npm start
   ```
2. It should auto-create `analytics.db`

---

## Environment Variable Issues

### ❌ ".env not found" or "undefined environment variables"

**Error:**
```
Cannot find module '.env'
process.env.JWT_SECRET is undefined
```

**Why:** `.env` file doesn't exist

**Fix:**
```bash
cd backend
cp .env.example .env
npm start
```

### ❌ "Invalid JWT_SECRET" or "Cannot verify token"

**Error:**
```
Error: invalid signature
jwt malformed
```

**Why:** JWT_SECRET in `.env` is wrong or missing

**Fix:**
1. **Check `.env` exists:**
   ```bash
   cd backend
   ls (Mac/Linux) or dir (Windows)
   # Should see .env in the list
   ```

2. **Edit `.env`** and ensure:
   ```env
   JWT_SECRET=something-here  # Must NOT be empty
   ADMIN_SETUP_KEY=something-here
   ```

3. **Don't commit secrets!** Add to `.gitignore`:
   ```
   .env
   ```
    (already done)

---

## Setup & Installation Issues

### ❌ "npm: command not found"

**Error:**
```
npm: command not found
node: command not found
```

**Why:** Node.js not installed or not in PATH

**Fix:**
1. **Install Node.js:** https://nodejs.org/ (v18+)
2. **Verify:**
   ```bash
   node --version
   npm --version
   ```
3. **Restart terminal after installing** (new PATH)

---

### ❌ "npm install fails" or "ERESOLVE unable to resolve dependency conflict"

**Error:**
```
npm ERR! ERESOLVE unable to resolve dependency conflict
npm ERR! code ENOENT
```

**Why:** Corrupted node_modules or npm cache

**Fix:**
```bash
cd backend

# Clear npm cache
npm cache clean --force

# Delete node_modules
rm -rf node_modules (Mac/Linux)
# or
rmdir /s /q node_modules (Windows)

# Delete package lock
rm package-lock.json

# Reinstall
npm install
```

---

## Dashboard & UI Issues

### ❌ "Dashboard blank or white screen"

**Error:**
```
Blank page when visiting http://localhost:5000/dashboard
```

**Why:** Backend not running or dashboard file missing

**Fix:**
1. **Check backend is running:**
   ```bash
   curl http://localhost:5000/health
   ```
   Should see: `{"status":"ok"}`

2. **Clear browser cache:**
   - Chrome: Ctrl+Shift+Delete → Clear data
   - Or use Incognito window

3. **Check browser console:**
   - F12 → Console → Any red errors?

4. **Check backend logs:**
   - Look at terminal where `npm start` is running
   - See any errors?

---

### ❌ "Cannot create admin" or "Admin setup fails"

**Error:**
```
Error: Invalid admin key
403 Forbidden
```

**Why:** Wrong or missing ADMIN_SETUP_KEY

**Fix:**
1. **Get your key from `.env`:**
   ```bash
   cd backend
   cat .env | grep ADMIN_SETUP_KEY  # Mac/Linux
   # or open in text editor (Windows)
   ```

2. **Visit setup URL with correct key:**
   ```
   http://localhost:5000/auth/setup?adminKey=YOUR_ACTUAL_KEY
   ```
   (Replace YOUR_ACTUAL_KEY with value from .env)

3. **If you forgot it:**
   - Update `.env` with a new value
   - Restart backend
   - Try again

---

## AI & Ollama Issues

### ❌ "Ollama timeout" or "Request timeout"

**Error:**
```
Error: Request timeout
Error: Socket timeout
```

**Why:** Ollama is slow or hasn't finished loading model

**Fix:**
- **Wait longer** — First request takes 5-15 seconds
- **Check model is loaded:**
  ```bash
  curl http://localhost:11434/api/tags
  ```
  You should see your model listed

- **If model missing**, pull it:
  ```bash
  ollama pull llama3.2
  # Wait for download (7-10GB)
  ```

- **Use smaller model:**
  Edit `.env`: `OLLAMA_MODEL=llama2` (faster, less memory)

---

### ❌ "Model not found" or "llama3.2: not found"

**Error:**
```
Error: model "llama3.2" not found
```

**Why:** Model hasn't been downloaded

**Fix:**
```bash
# See what models you have
ollama list

# Download the model
ollama pull llama3.2  # Takes 5-10 minutes!

# Start Ollama again
ollama serve
```

---

### ❌ "Out of memory" when running Ollama

**Error:**
```
CUDA out of memory
Device out of memory
```

**Why:** Model too large for your GPU or system RAM

**Fix:**
1. **Close other apps** (browsers, IDEs, etc.)
2. **Use smaller model:**
   ```bash
   ollama pull llama2
   ```
   Edit `.env`: `OLLAMA_MODEL=llama2`

3. **Restart Ollama:**
   ```bash
   ollama serve
   ```

---

## Git & Version Control Issues

### ❌ "fatal: not a git repository"

**Error:**
```
fatal: not a git repository (or any parent up to mount point)
```

**Why:** You're not in the project folder

**Fix:**
```bash
# Navigate to project
cd "c:\Users\[YourUsername]\Desktop\Mumbai hackathon"

# Verify
git status
```

---

### ❌ "Permission denied" when running setup scripts

**Error (Mac/Linux):**
```
Permission denied: ./setup.sh
```

**Fix:**
```bash
chmod +x setup.sh
./setup.sh
```

---

## Performance Issues

### ⚠️ "Dashboard is very slow"

**Why:**
- Ollama first request is slow (5-15s)
- Too much data in database
- Low system resources

**Fix:**
1. **Wait for initial requests** (they'll be cached)
2. **Use smaller time range** (last 7 days instead of 90)
3. **Limit data:**
   - Delete old projects
   - Clear database: delete `analytics.db`
4. **Use lighter Ollama model:** Change `.env`

---

### ⚠️ "AI responses are generic or bad quality"

**Why:**
- Model isn't powerful enough
- Not enough data in database
- Model needs fine-tuning

**Fix:**
1. **Use better model:**
   - Install: `ollama pull llama3.2` (better)
   - Or try: `ollama pull mistral` or `ollama pull neural-chat`
   - Change `.env`: `OLLAMA_MODEL=mistral`

2. **Generate more test data:**
   - Create test projects
   - Embed tracker code
   - Interact with multiple pages

3. **Provide more context** in AI queries

---

## Still Stuck?

### Debugging Checklist

1. **Restart everything:**
   ```bash
   # Kill processes
   killall node ollama  # Mac/Linux
   # or
   taskkill /IM node.exe /IM ollama.exe /F  # Windows
   
   # Start fresh
   ollama serve  # Terminal 1
   npm start      # Terminal 2
   ```

2. **Check logs:**
   - Look at terminal output where backend/Ollama runs
   - Copy-paste any error messages

3. **Verify URLs:**
   - Ollama health: `curl http://localhost:11434/api/tags`
   - Backend health: `curl http://localhost:5000/health`
   - Dashboard: http://localhost:5000/dashboard

4. **Check config:**
   - Verify `.env` exists: `cat backend/.env` (Mac/Linux) or open in editor (Windows)
   - Confirm all required variables set

5. **Clear everything and restart:**
   - Delete `backend/analytics.db`
   - Delete `backend/node_modules`
   - Run `npm install` again
   - Restart

### Getting Help

**Share with team:**
1. Full error message (copy from terminal)
2. What you were doing when it happened
3. Your OS (Windows/Mac/Linux)
4. Output of `node --version` and `npm --version`

**Common fix:** 99% of issues are solved by restarting. Try that first! 🔄

