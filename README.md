# Ace775 Automation & Multi-Account Web Dashboard

Automated bot, multi-account manager, and web control panel for **ace775.com**, designed for 24/7 scheduled execution on a Linux VPS or local machine.

---

## ⚡ Core Capabilities

### 1. Multi-Account Management
- Add, edit, delete, and enable/disable multiple accounts with Ghana phone numbers, passwords, and custom labels.
- Auto-normalizes phone numbers (handles leading `0` or `+233`).
- Single-click **`▶ Run All Active`** batch runner with anti-ban account pacing.

### 2. Smart Working Hours Auto-Scheduler & Auto-Retry
- Runs automatically at your configured daytime hour (e.g. **09:00 AM**).
- **Auto-Retry Engine**: If Ace775 responds with `"Outside working hours"`, the bot automatically sleeps and retries every 30 minutes until the platform window opens, completes all tasks, and sends a Telegram notification.

### 3. Two-Way Interactive Telegram Bot
Control and monitor your bot directly from Telegram!
Send these commands to your Telegram Bot:
- **`/status`** or **`/balance`** - Live overview of all accounts, VIP tiers, balances, and today's earnings.
- **`/run`** - Trigger immediate batch execution of all active accounts from your phone.
- **`/accounts`** - List all configured accounts and their active status.
- **`/help`** - View available commands.
*(Security: The bot only listens and responds to your authorized `TELEGRAM_CHAT_ID`)*.

### 4. Anti-Ban Stealth & Human Delays
- **Randomized Task Jitter**: 3.5s – 6.5s natural pause between task executions.
- **Countdown Variance**: Human-like micro-variations during timer countdowns.
- **Account Pacing**: 15s – 25s cooldown between accounts during batch runs.

### 5. Financial Analytics & 7-Day Performance
- Interactive visual chart on the dashboard tracking daily GHS earnings and completed task counts over the last 7 days.
- Real-time Server-Sent Events (SSE) live terminal console.

---

## 📁 Project Structure

```text
task_ace/
├── app.py                  # FastAPI server, REST API, & background workers
├── db.py                   # SQLite database for accounts, settings, & analytics
├── scheduler.py            # Smart Working Hours Auto-Scheduler & Auto-Retry
├── telegram_listener.py    # Two-way Telegram bot listener (/status, /run)
├── ace_bot.py              # Core automation engine (API & Playwright bots)
├── setup_vps.sh            # 1-command installer script for Linux VPS
├── requirements.txt        # Dependencies (FastAPI, Uvicorn, Playwright, Requests)
├── static/
│   ├── css/
│   │   └── dashboard.css   # Dark-mode styling with glassmorphism & chart
│   ├── js/
│   │   └── dashboard.js    # Reactive frontend logic, analytics, & SSE stream
│   ├── index.html          # Control center single-page app
│   └── login.html          # Password-only master lock screen
└── README.md               # Documentation and guides
```

---

## 🚀 Quick Start (Local)

1. Run the server:
   ```bash
   python app.py
   ```
2. Open your browser:
   ```text
   http://localhost:8000
   ```
3. Enter your Master Password (default: `admin123` or set in `.env`/database) to unlock the dashboard.

---

## 🌐 Quick Start (Linux VPS)

### 1. Clone the Repository
```bash
git clone https://github.com/lenoxspider/ace_task.git
cd ace_task
```

### 2. Run the 1-Command Installer
```bash
chmod +x setup_vps.sh
./setup_vps.sh
```
*The installer will:*
- Install all dependencies (Python, virtual environment, Playwright Chromium).
- Interactively prompt you to set your secret **Master Password**.
- Automatically configure and start the **24/7 background system service (`ace775.service`)** that auto-starts on VPS boot!

### 3. Access Your Dashboard & Control Bot
Open your browser at `http://<YOUR-VPS-IP>:8000`, enter your Master Password, and manage all accounts!

#### Useful Background Service Commands:
```bash
# Check if running
sudo systemctl status ace775

# View live dashboard and automation log
tail -f dashboard.log

# Restart or stop
sudo systemctl restart ace775
sudo systemctl stop ace775
```

