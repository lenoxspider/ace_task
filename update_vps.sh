#!/usr/bin/env bash
# ==============================================================================
# Ace775 VPS 1-Click Update Script
# Pulls latest code from GitHub, updates dependencies, and restarts service.
# ==============================================================================

set -e

echo "=================================================="
echo "      🔄 Updating Ace775 Platform on VPS          "
echo "=================================================="

# 1. Pull latest code from GitHub
echo "[1/3] Pulling latest updates from GitHub..."
git pull origin main

# 2. Update Python dependencies if requirements changed
if [ -d "venv" ]; then
    echo "[2/3] Checking & updating Python packages..."
    source venv/bin/activate
    pip install -r requirements.txt --quiet
else
    echo "[2/3] Virtual environment not found, skipping pip install."
fi

# 3. Restart the background systemd service
echo "[3/3] Restarting background service..."
if command -v systemctl >/dev/null 2>&1 && sudo systemctl is-active --quiet ace775; then
    sudo systemctl restart ace775
    echo "✅ Background service 'ace775' successfully restarted!"
    echo ""
    echo "📋 Current Service Status:"
    sudo systemctl status ace775 --no-pager -n 5
else
    echo "Restarting background process with nohup..."
    pkill -f "python app.py" || true
    nohup ./venv/bin/python app.py > dashboard.log 2>&1 &
    echo "✅ Application restarted with nohup."
fi

echo ""
echo "=================================================="
echo "  🎉 Update Complete! All systems live & updated."
echo "=================================================="
