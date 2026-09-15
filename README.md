# Ace775 Automation & Multi-Account Web Dashboard

Scheduled task automation, multi-account management, and a web control panel for **ace775.com**, built to run unattended on a Linux VPS or a local machine.

---

## ⚡ Core Capabilities

### 1. Multi-Account Management
- Add, edit, delete, and enable/disable multiple accounts with Ghana phone numbers, passwords, and custom labels.
- Auto-normalizes phone numbers (handles a leading `0` or `+233`).
- Single-click **`▶ Run All Active`** batch runner, with pacing between accounts.

### 2. Working Hours Auto-Scheduler & Auto-Retry
- Runs automatically at your configured daytime hour (e.g. **09:00**).
- **Auto-Retry Engine**: if Ace775 answers `"Outside working hours"`, the bot waits and retries every 30 minutes until the platform window opens, finishes the remaining tasks, then sends a Telegram notification.
- Every working-hours check (task window, withdrawal window, Sunday closure) is evaluated in **GMT** to match the platform, independent of the host's local clock.

### 3. Two-Way Interactive Telegram Bot
Control and monitor the bot from Telegram:
- **`/schedule`** or **`/today`** – today's task timeline and pending withdrawal queue.
- **`/status`** or **`/balance`** – live overview of accounts, VIP tiers, balances, and today's earnings.
- **`/run`** – trigger a batch execution from your phone.
- **`/accounts`** – list configured accounts and their active status.
- **`/help`** – list available commands.

Security: the bot only listens and responds to your authorized `TELEGRAM_CHAT_ID`.

### 4. Telegram Reports & Daily Digests
- **Midnight Briefing**: sent when the day's task slots are allocated.
- **18:00 Financial Digest**: consolidated report once the withdrawal window closes (revenue, balances, processed vs queued withdrawals).
- **Account Health Alerts**: notifications when an account hits credential or authentication errors.

### 5. Scheduling & Execution Pacing
- **Task Order**: the order in which an account's tasks run is randomized, so the sequence is never fixed.
- **Spaced Execution**: runs are spread 15–35 minutes apart, starting from 12:00 AM midnight.
- **Withdrawal Queue**: withdrawals are queued and spaced out within the 09:00–17:00 (Mon–Fri) window.
- **Timer Variance**: small variations during countdowns.

### 6. Financial Analytics & 7-Day Performance
- Interactive chart tracking daily GHS earnings and completed task counts over the last 7 days.
- Real-time Server-Sent Events (SSE) live terminal console.
- Today's profit is read from a single source, so the dashboard card, the per-account cards and the chart always agree.

---

## 📁 Project Structure

```text
task_ace/
├── app.py                  # FastAPI server, REST API, & background workers
├── db.py                   # SQLite database for accounts, settings, & analytics
├── scheduler.py            # Working Hours Auto-Scheduler & Auto-Retry
├── telegram_listener.py    # Two-way Telegram bot listener (/status, /run)
├── ace_bot.py              # Core automation engine (API & Playwright bots)
├── setup_vps.sh            # 1-command installer script for Linux VPS
├── update_vps.sh           # 1-command updater (git pull + service restart)
├── nginx_ace775.conf       # Reverse proxy config (SSE-ready, HTTPS block included)
├── requirements.txt        # Dependencies (FastAPI, Uvicorn, Playwright, Requests)
├── static/
│   ├── css/                # Dashboard styling (dark mode, glassmorphism, chart)
│   ├── js/                 # Frontend logic (modules/ + SSE stream)
│   ├── index.html          # Control center single-page app
│   └── login.html          # Password-only master lock screen
└── README.md               # Documentation and guides
```

---

## 🚀 Quick Start (Local)

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Run the server:
   ```bash
   python app.py
   ```
3. Open the dashboard:
   ```text
   http://localhost:8000
   ```
4. Enter your Master Password (default: `admin123`, or set it in `.env` / the database) to unlock the dashboard.

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
The installer will:
- Install all dependencies (Python, virtual environment, Playwright Chromium).
- Prompt you to set your secret **Master Password**.
- Configure and start the **24/7 background service (`ace775.service`)** that starts on boot.

### 3. Access the Dashboard
Open `http://<YOUR-VPS-IP>:8000`, enter your Master Password, and manage your accounts.

### Updating an Existing Install
```bash
chmod +x update_vps.sh
./update_vps.sh
```
This pulls the latest code, refreshes dependencies, and restarts the service.

---

## 🔧 Background Service Commands

```bash
# Check if running
sudo systemctl status ace775

# View the live log
tail -f dashboard.log

# Restart or stop
sudo systemctl restart ace775
sudo systemctl stop ace775
```

---

## 📝 Operational Notes

- **Timezone**: the platform works to GMT, so scheduling, the daily rollover and daily totals are all evaluated in GMT no matter where the VPS is hosted.
- **Concurrency**: batch runs are serialized and each account is locked while it runs, so a scheduled run, the dashboard button and the Telegram `/run` command cannot overlap.
- **Storage**: SQLite runs in WAL mode with a busy timeout, so dashboard, scheduler and Telegram writes do not block each other.
- **Retention**: the run log keeps the most recent 500 entries.
