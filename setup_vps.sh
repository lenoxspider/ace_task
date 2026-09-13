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
echo "[1/4] Installing system dependencies (Python3, venv, curl, git, sqlite3)..."
sudo apt-get update -y
sudo apt-get install -y python3 python3-pip python3-venv curl git sqlite3

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

# 6. Automatic 24/7 Background Service Setup (systemd)
echo ""
echo "=================================================="
echo "[6/6] ⚙️ Configuring 24/7 Background Service"
echo "=================================================="
CURRENT_DIR=$(pwd)
CURRENT_USER=$(whoami)
SERVICE_FILE="/etc/systemd/system/ace775.service"

if command -v systemctl >/dev/null 2>&1; then
    echo "Creating automated systemd service at $SERVICE_FILE..."
    sudo bash -c "cat <<EOF > $SERVICE_FILE
[Unit]
Description=Ace775 Automation Control Center & Scheduler
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$CURRENT_DIR
ExecStart=$CURRENT_DIR/venv/bin/python $CURRENT_DIR/app.py
Restart=always
RestartSec=5
StandardOutput=append:$CURRENT_DIR/dashboard.log
StandardError=append:$CURRENT_DIR/dashboard.log

[Install]
WantedBy=multi-user.target
EOF"

    sudo systemctl daemon-reload
    sudo systemctl enable ace775
    sudo systemctl restart ace775
    echo "✅ 24/7 Background Service is active & enabled on boot!"
else
    echo "systemctl not detected. Starting in background with nohup..."
    nohup ./venv/bin/python app.py > dashboard.log 2>&1 &
fi

echo ""
echo "=================================================="
echo "  🎉 Installation Complete & Running in Background!"
echo "=================================================="
echo ""
echo "🌐 Access your Web Dashboard:"
echo "     http://<your-vps-ip>:8000"
echo "   (Enter your Master Password to unlock!)"
echo ""
echo "📋 Manage Background Service:"
echo "     Check status : sudo systemctl status ace775"
echo "     View live log: tail -f dashboard.log"
echo "     Restart      : sudo systemctl restart ace775"
echo "     Stop         : sudo systemctl stop ace775"
echo ""
echo "🤖 Two-Way Telegram Control:"
echo "     Send /status, /balance, or /run directly to your bot anytime!"
echo ""
echo "🔒 Optional: Setup Nginx Reverse Proxy & SSL / HTTPS (#15):"
echo "     Template ready at: nginx_ace775.conf"
echo "     sudo cp nginx_ace775.conf /etc/nginx/sites-available/ace775"
echo "     sudo ln -sf /etc/nginx/sites-available/ace775 /etc/nginx/sites-enabled/"
echo "     sudo nginx -t && sudo systemctl reload nginx"
echo "     sudo certbot --nginx -d yourdomain.com"
echo "=================================================="


