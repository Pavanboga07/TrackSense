@echo off
REM ════════════════════════════════════════════════════════════════════════════════
REM Quick Setup Script for Windows (Batch)
REM Run this script to automatically set up the project
REM Usage: Double-click this file OR: setup.bat
REM ════════════════════════════════════════════════════════════════════════════════

echo.
echo ███████████████████████████████████████████████████████████████████████████████
echo   TRACKSENSE - Quick Setup (Windows)
echo ███████████████████████████████████████████████████████████████████████████████
echo.

REM Check Node.js
echo [1/5] Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js not found! Download from https://nodejs.org/
    pause
    exit /b 1
)
echo ✓ Node.js found: %NODE_VERSION%

REM Check Git
echo [2/5] Checking Git...
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Git not found! Download from https://git-scm.com/
    pause
    exit /b 1
)
echo ✓ Git ready

REM Check Ollama
echo [3/5] Checking Ollama...
curl -s http://localhost:11434/api/tags >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  Ollama not running! Start it with: ollama serve
    echo    (You can do this in a new terminal and come back here)
    pause
)
echo ✓ Ollama check passed

REM Install backend dependencies
echo [4/5] Installing backend dependencies...
cd backend
if exist node_modules (
    echo    (dependencies already installed, skipping)
) else (
    call npm install
)
if %errorlevel% neq 0 (
    echo ❌ npm install failed!
    pause
    exit /b 1
)
echo ✓ Dependencies installed
cd ..

REM Create .env from .env.example
echo [5/5] Setting up environment...
cd backend
if exist .env (
    echo    (.env already exists, skipping)
) else (
    copy .env.example .env >nul
    echo ✓ Created .env file
    echo    ⚠️  Please edit .env and change:
    echo      - JWT_SECRET (use a random 32-char string)
    echo      - ADMIN_SETUP_KEY (use a random string)
    echo      - OLLAMA_URL if Ollama is on different machine
)
cd ..

echo.
echo ███████████████████████████████████████████████████████████████████████████████
echo   ✅ Setup Complete!
echo ███████████████████████████████████████████████████████████████████████████████
echo.
echo 📋 Next Steps:
echo.
echo 1. Edit .env file:
echo    backend\.env
echo.
echo 2. Make sure Ollama is running:
echo    ollama serve
echo    (in a separate terminal)
echo.
echo 3. Start the backend:
echo    cd backend
echo    npm start
echo.
echo 4. Open dashboard:
echo    http://localhost:5000/dashboard
echo.
echo 📖 For complete setup guide, see: SETUP.md
echo.
pause
