#!/usr/bin/env bash
# ==============================================================================
# Ace775 Linux VPS Setup Script with Web Dashboard & Multi-Account Manager
# Works on: Ubuntu 20.04+, Debian 11+, and similar Linux distributions.
# ==============================================================================

set -e

echo "=================================================="
echo "      Ace775 VPS Setup & Web Dashboard Installer  "
echo "=================================================="

# 1. Update package list & install system dependencies
echo "[1/4] Installing system dependencies (Python3, venv, curl, system libraries)..."
sudo apt-get update -y
sudo apt-get install -y python3 python3-pip python3-venv curl libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2

# 2. Create Python virtual environment
echo "[2/4] Setting up Python virtual environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo "Created virtual environment 'venv'."
fi

source venv/bin/activate

# 3. Upgrade pip and install requirements (FastAPI, Uvicorn, Playwright, Requests)
echo "[3/4] Installing Python requirements..."
pip install --upgrade pip
pip install -r requirements.txt

# 4. Install Playwright browser binaries with system dependencies
echo "[4/5] Installing Playwright Chromium browser & OS libraries..."
python -m playwright install --with-deps chromium

# 5. Dashboard Security Setup: Set Master Access Password
echo ""
echo "=================================================="
echo "[5/5] 🔐 Web Dashboard Master Password Setup"
echo "=================================================="
echo "Protect your web dashboard with a master password."
echo "This password is required to unlock the web dashboard on your VPS."
echo ""

while true; do
    read -s -p "Enter Master Password for Web Dashboard: " DASH_PASS
    echo ""
    if [ -z "$DASH_PASS" ]; then
        echo "Password cannot be empty. Please try again."
        continue
    fi
    read -s -p "Confirm Master Password: " DASH_PASS_CONFIRM
    echo ""
    if [ "$DASH_PASS" != "$DASH_PASS_CONFIRM" ]; then
        echo "❌ Passwords do not match. Please try again."
    else
        break
    fi
done

# Ensure .env exists
if [ ! -f ".env" ]; then
    cp .env.example .env
fi

# Update or append DASHBOARD_PASSWORD in .env
if grep -q "^DASHBOARD_PASSWORD=" .env; then
    sed -i "s|^DASHBOARD_PASSWORD=.*|DASHBOARD_PASSWORD=$DASH_PASS|" .env
else
    echo "DASHBOARD_PASSWORD=$DASH_PASS" >> .env
fi

# Seed password into SQLite database settings
python -c "import db; db.set_setting('dashboard_password', '$DASH_PASS')"
echo "✅ Master password successfully saved!"

echo ""
echo "=================================================="
echo "  Installation Complete!"
echo "=================================================="
echo ""
echo "🚀 To launch the Web Dashboard:"
echo "     source venv/bin/activate"
echo "     python app.py"
echo "   Then open http://<your-vps-ip>:8000 in your browser and enter your Master Password!"
echo ""
echo "🤖 To run automation directly from CLI:"
echo "     python ace_bot.py --mode api"
echo ""
echo "⚙️ To keep the Web Dashboard running in background (systemd):"
echo "   Run the dashboard with nohup, tmux, or create a systemd service:"
echo "     nohup ./venv/bin/python app.py > dashboard.log 2>&1 &"
echo "=================================================="

