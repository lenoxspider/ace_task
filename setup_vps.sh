#!/usr/bin/env bash
# ==============================================================================
# Ace775 Linux VPS Setup Script
# Works on: Ubuntu 20.04+, Debian 11+, and similar Linux distributions.
# ==============================================================================

set -e

echo "=================================================="
echo "          Ace775 VPS Setup & Installation         "
echo "=================================================="

# 1. Update package list & install system dependencies
echo "[1/4] Installing system dependencies (Python3, venv, curl)..."
sudo apt-get update -y
sudo apt-get install -y python3 python3-pip python3-venv curl libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2

# 2. Create Python virtual environment
echo "[2/4] Setting up Python virtual environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo "Created virtual environment 'venv'."
fi

# Activate venv
source venv/bin/activate

# 3. Upgrade pip and install requirements
echo "[3/4] Installing Python requirements..."
pip install --upgrade pip
pip install -r requirements.txt

# 4. Install Playwright browser binaries with system dependencies
echo "[4/4] Installing Playwright Chromium browser & OS libraries..."
python -m playwright install --with-deps chromium

echo ""
echo "=================================================="
echo "  Installation Complete!"
echo "=================================================="
echo ""
echo "Next Steps:"
echo "1. Configure your credentials in .env:"
echo "     nano .env"
echo "   Set ACE_PHONE and ACE_PASSWORD."
echo ""
echo "2. Run a test manually:"
echo "     source venv/bin/activate"
echo "     python ace_bot.py --mode browser"
echo "   Or use lightweight API mode (great for low-RAM VPS):"
echo "     python ace_bot.py --mode api"
echo ""
echo "3. Automate with Cron (run daily at 8:00 AM):"
echo "     crontab -e"
echo "   Add the line below (adjust /path/to/task_ace):"
echo "     0 8 * * * cd $(pwd) && ./venv/bin/python ace_bot.py >> cron.log 2>&1"
echo "=================================================="
