# Ace775 Automation Bot (Linux VPS & Local)

Automated script for **ace775.com** designed for scheduled daily execution on a Linux VPS or local machine.

---

## Features
- **Account Login**: Automatic authentication via Phone number and Password (no SMS or captcha needed).
- **Daily Sign-In / Check-in**: Automatically claims daily attendance points.
- **Daily Tasks Automation**:
  - Scans all ongoing/incomplete tasks.
  - Opens task details.
  - Waits for video/timer countdown.
  - Submits task completion for rewards.
  - Handles 5-star rating confirmation modals automatically.
- **Dual Engine**:
  - **Playwright Headless Browser Mode**: Real mobile browser emulation, full JavaScript execution, handles Vue animations and dialogs.
  - **Direct API Mode**: Ultra-fast HTTP requests mode (requires < 30MB RAM, perfect for 512MB/1GB Linux VPS).

---

## Project Structure

```text
task_ace/
├── ace_bot.py          # Main automation script (Playwright & Direct API modes)
├── setup_vps.sh        # One-command installer for Linux VPS (Ubuntu/Debian)
├── requirements.txt    # Python packages (playwright, requests, python-dotenv)
├── .env.example        # Environment variables template
├── .env                # Your active credentials and configuration
└── README.md           # Documentation and guides
```

---

## Quick Start on Linux VPS (Ubuntu / Debian)

### 1. Upload or Clone the folder to your VPS
```bash
# Example: place in ~/task_ace
cd ~/task_ace
```

### 2. Run the Setup Script
Make the setup script executable and run it:
```bash
chmod +x setup_vps.sh
./setup_vps.sh
```
This will automatically:
- Install Python 3, pip, venv, and required system libraries.
- Create a virtual environment `venv`.
- Install Python dependencies (`requirements.txt`).
- Download and configure Playwright Chromium with system dependencies.

### 3. Set Your Credentials
Edit `.env` with your editor:
```bash
nano .env
```
Fill in your phone number and password:
```env
ACE_PHONE=0501234567
ACE_PASSWORD=your_password_here
ACE_MODE=browser
ACE_HEADLESS=true
DO_CHECKIN=true
DO_TASKS=true
ACE_BASE_URL=https://ace775.com
```

### 4. Test the Bot
Activate the virtual environment and run:
```bash
source venv/bin/activate

# Test in Playwright Browser mode:
python ace_bot.py --mode browser

# Or test in Direct API mode (fast):
python ace_bot.py --mode api
```

---

## Daily Scheduling with Cron

To run the bot automatically every day (e.g. at 08:30 AM every morning):

1. Open crontab:
```bash
crontab -e
```

2. Add this line at the bottom (replace `/root/task_ace` with your actual path):
```cron
30 8 * * * cd /root/task_ace && ./venv/bin/python ace_bot.py >> /root/task_ace/bot.log 2>&1
```

3. Save and exit. The bot will now run every morning, complete all daily tasks and check-in, and log the output to `bot.log`.

---

## Command Line Arguments

You can also pass arguments directly without modifying `.env`:

```bash
# Run with custom credentials:
python ace_bot.py --phone 0501234567 --password mypassword

# Run only tasks (skip check-in):
python ace_bot.py --no-checkin

# Run only check-in (skip tasks):
python ace_bot.py --no-tasks

# Run in Direct API mode:
python ace_bot.py --mode api
```
