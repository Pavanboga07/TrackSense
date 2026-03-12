#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════════
# Quick Setup Script for Mac/Linux
# Run this script to automatically set up the project
# Usage: bash setup.sh OR chmod +x setup.sh && ./setup.sh
# ════════════════════════════════════════════════════════════════════════════════

set -e  # Exit on error

echo ""
echo "███████████████████████████████████████████████████████████████████████████████"
echo "  TRACKSENSE - Quick Setup (Mac/Linux)"
echo "███████████████████████████████████████████████████████████████████████████████"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Node.js
echo "[1/5] Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found!${NC}"
    echo "Download from: https://nodejs.org/"
    exit 1
fi
NODE_VERSION=$(node --version)
echo -e "${GREEN}✓${NC} Node.js found: $NODE_VERSION"

# Check Git
echo "[2/5] Checking Git..."
if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Git not found!${NC}"
    echo "Install with: brew install git (Mac) or apt-get install git (Linux)"
    exit 1
fi
echo -e "${GREEN}✓${NC} Git ready"

# Check Ollama
echo "[3/5] Checking Ollama..."
if ! curl -s http://localhost:11434/api/tags &> /dev/null; then
    echo -e "${YELLOW}⚠️  Ollama not running!${NC}"
    echo "Start it in another terminal with: ollama serve"
    read -p "Press Enter to continue anyway, or Ctrl+C to exit..."
else
    echo -e "${GREEN}✓${NC} Ollama is running"
fi

# Install backend dependencies
echo "[4/5] Installing backend dependencies..."
cd backend
if [ -d "node_modules" ]; then
    echo "    (dependencies already installed, skipping)"
else
    npm install || {
        echo -e "${RED}❌ npm install failed!${NC}"
        exit 1
    }
fi
echo -e "${GREEN}✓${NC} Dependencies installed"
cd ..

# Create .env from .env.example
echo "[5/5] Setting up environment..."
cd backend
if [ -f ".env" ]; then
    echo "    (.env already exists, skipping)"
else
    cp .env.example .env
    echo -e "${GREEN}✓${NC} Created .env file"
    echo -e "${YELLOW}    ⚠️  Please edit .env and change:${NC}"
    echo "       - JWT_SECRET (use: openssl rand -base64 32)"
    echo "       - ADMIN_SETUP_KEY (use any random 32-char string)"
    echo "       - OLLAMA_URL if Ollama is on different machine"
fi
cd ..

echo ""
echo "███████████████████████████████████████████████████████████████████████████████"
echo -e "${GREEN}  ✅ Setup Complete!${NC}"
echo "███████████████████████████████████████████████████████████████████████████████"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Edit .env file:"
echo "   nano backend/.env"
echo ""
echo "2. Make sure Ollama is running:"
echo "   ollama serve"
echo "   (in a separate terminal)"
echo ""
echo "3. Start the backend:"
echo "   cd backend"
echo "   npm start"
echo ""
echo "4. Open dashboard:"
echo "   http://localhost:5000/dashboard"
echo ""
echo "📖 For complete setup guide, see: SETUP.md"
echo ""
