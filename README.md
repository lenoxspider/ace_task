# Ace775 Automation & Multi-Account Web Dashboard

Automated bot and modern web control panel for **ace775.com**, designed for scheduled daily execution on a Linux VPS or local machine.

---

## ⚡ Features
- **Modern Web Dashboard**: Sleek dark-mode interface built with FastAPI, Vanilla CSS, and JavaScript.
- **Multi-Account Manager**: Add, edit, delete, and enable/disable multiple accounts with nicknames, phone numbers, and max-task limits.
- **One-Click & Batch Execution**: Run all active accounts sequentially with one click ("Run All Active") or run individual accounts on demand.
- **Live Terminal Console**: Stream real-time logs via Server-Sent Events (SSE) directly into the dashboard console.
- **Stats Overview**: Track total accounts, daily tasks completed, and total earnings in GHS.
- **Daily Telegram Reports**: Receive detailed summary reports per run directly to your Telegram chat.
- **Dual Execution Engine**:
  - **Direct API Mode (Recommended)**: Ultra-fast HTTP mode requiring `< 30MB RAM` (ideal for budget Linux VPS).
  - **Playwright Headless Browser Mode**: Real mobile browser emulation (`w750` mobile SPA viewport / 375x812).

---

## 📁 Project Structure

```text
task_ace/
├── app.py                  # FastAPI web server, REST API, & background task runner
├── db.py                   # SQLite database manager for accounts & settings
├── ace_bot.py              # Core automation engine (API & Playwright bots)
├── setup_vps.sh            # 1-command installer script for Linux VPS (Ubuntu/Debian)
├── requirements.txt        # Python packages (FastAPI, Uvicorn, Playwright, Requests, etc.)
├── .env.example            # Environment variables template
├── .env                    # Active local credentials (gitignored)
├── static/
│   ├── css/
│   │   └── dashboard.css   # Dark-mode glassmorphic styling
│   ├── js/
│   │   └── dashboard.js    # Reactive frontend logic & SSE log streaming
│   └── index.html          # Semantic single-page dashboard
└── README.md               # Documentation and guides
```

---

## 🚀 Quick Start on Local Machine

1. Open a terminal in `task_ace`:
   ```bash
   python app.py
   ```
2. Open your browser and go to:
   ```text
   http://localhost:8000
   ```
3. Use the **+ Add Account** button to add your phone numbers and passwords.
4. Click **▶ Run** on any account or **▶ Run All Active** to start automation!

---

## 🌐 Quick Start on Linux VPS (Ubuntu / Debian)

### 1. Upload or Clone the Repository
```bash
git clone https://github.com/lenoxspider/ace_task.git
cd ace_task
```

### 2. Run the Setup Script
```bash
chmod +x setup_vps.sh
./setup_vps.sh
```

### 3. Launch the Web Dashboard
```bash
source venv/bin/activate
python app.py
```
*(Access the dashboard at `http://<YOUR-VPS-IP>:8000`)*

### 4. Running 24/7 in Background on VPS (systemd or nohup)
To keep the dashboard alive after closing SSH:
```bash
nohup ./venv/bin/python app.py > dashboard.log 2>&1 &
```

Or configure a systemd service:
```bash
sudo nano /etc/systemd/system/ace-dashboard.service
```
```ini
[Unit]
Description=Ace775 Web Dashboard
After=network.target

[Service]
User=root
WorkingDirectory=/root/ace_task
ExecStart=/root/ace_task/venv/bin/python app.py
Restart=always

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable ace-dashboard
sudo systemctl start ace-dashboard
```

---

## 📱 Telegram Notifications Setup
Click the **⚙️ Settings** button on the top right of the dashboard:
1. Enter your `Telegram Bot Token` (from [@BotFather](https://t.me/BotFather)).
2. Enter your `Telegram Chat ID` (from [@userinfobot](https://t.me/userinfobot)).
3. Click **Save Settings**.
The bot will now automatically send a formatted summary report whenever accounts are run!
