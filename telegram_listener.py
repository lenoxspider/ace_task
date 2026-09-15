"""
Interactive Two-Way Telegram Bot Listener for Ace775 Bot
Allows monitoring status, checking balances, and triggering runs directly from Telegram.
"""

import os
import time
import logging
import threading
import requests
from datetime import datetime
from typing import Callable, Optional

import db

logger = logging.getLogger("TelegramListener")


class TelegramCommandBot:
    def __init__(self, run_all_callback: Optional[Callable] = None):
        self.run_all_callback = run_all_callback
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.last_update_id = 0

    def get_token_and_chat(self):
        token = db.get_setting("telegram_token", os.getenv("TELEGRAM_BOT_TOKEN", "")).strip()
        chat_id = db.get_setting("telegram_chat_id", os.getenv("TELEGRAM_CHAT_ID", "")).strip()
        return token, chat_id

    @property
    def is_configured(self) -> bool:
        token, chat_id = self.get_token_and_chat()
        return bool(token and chat_id)

    def send_message(self, text: str):
        token, chat_id = self.get_token_and_chat()
        if not token or not chat_id:
            return
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        try:
            requests.post(url, json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML"
            }, timeout=10)
        except Exception as e:
            logger.error(f"Failed to send Telegram message: {e}")

    def handle_command(self, text: str, sender_chat_id: str):
        token, authorized_chat_id = self.get_token_and_chat()
        # Security check: only respond to the authorized chat_id
        if str(sender_chat_id) != str(authorized_chat_id):
            logger.warning(f"Unauthorized Telegram access attempt from chat_id: {sender_chat_id}")
            return

        cmd = text.strip().lower()

        if cmd in ["/start", "/help"]:
            msg = (
                "⚡ <b>Ace775 Command Center Bot</b>\n\n"
                "Available commands:\n"
                "• <b>/schedule</b> or <b>/today</b> - View today's randomized task timeline & withdrawal queue\n"
                "• <b>/status</b> or <b>/balance</b> - View live account balances & today's earnings\n"
                "• <b>/run</b> - Trigger automation run for all active accounts\n"
                "• <b>/accounts</b> - List all configured accounts\n"
                "• <b>/help</b> - Show this message\n"
            )
            self.send_message(msg)

        elif cmd in ["/schedule", "/today", "/timeline"]:
            from scheduler import scheduler
            now = db.utc_now()
            today_str = now.strftime("%Y-%m-%d")
            time_now_str = now.strftime("%H:%M:%S")

            if now.weekday() == 6:
                self.send_message(
                    "⏸️ <b>Today is Sunday (Platform Rest Day)!</b>\n\n"
                    "• Ace775 tasks are suspended on Sundays.\n"
                    "• Withdrawals are closed on weekends.\n"
                    "• Next task automation cycle starts Monday at 12:00 AM midnight."
                )
                return

            # Ensure schedule is populated or restored from db
            sched_status = scheduler.get_status()
            task_slots = sched_status.get("daily_task_schedule", [])
            if not task_slots:
                scheduler.ensure_schedule()
                sched_status = scheduler.get_status()
                task_slots = sched_status.get("daily_task_schedule", [])

            q_items = db.get_withdrawal_queue()

            lines = [
                "📅 <b>Ace775 Today's Operations Schedule</b>",
                f"🕒 <i>Current Time: {time_now_str} (GMT)</i>",
                ""
            ]

            # 1. Tasks section
            lines.append("🤖 <b>Automated Tasks Timeline (Pattern-Free):</b>")
            if not task_slots:
                midnight_enabled = db.get_setting("midnight_scheduler_enabled", "1") == "1"
                accounts = db.get_accounts()
                active_accounts = [a for a in accounts if a.get("enabled", 1)]

                completed_today = []
                for a in active_accounts:
                    last_run = a.get("last_run_time") or ""
                    status = (a.get("last_status") or "").lower()
                    target_tasks = int(a.get("max_tasks") or 0)
                    tasks_done = int(a.get("tasks_done_today") or 0)
                    if target_tasks > 0:
                        is_done = ("completed" in status or tasks_done >= target_tasks)
                    else:
                        is_done = ("completed" in status)
                    if last_run.startswith(today_str) and is_done:
                        completed_today.append(a)

                if not midnight_enabled:
                    lines.append("  <i>⚠️ Pattern-Free Scheduler is currently disabled in Settings.</i>")
                elif not active_accounts:
                    lines.append("  <i>ℹ️ No active accounts configured. Add or enable accounts in the dashboard.</i>")
                elif completed_today and len(completed_today) == len(active_accounts):
                    lines.append("  <b>✅ All active accounts have already completed today's tasks:</b>")
                    for a in completed_today:
                        lbl = a.get("label") or a["phone"]
                        t_done = a.get("tasks_done_today", 0)
                        last_t = (a.get("last_run_time") or "")[11:16]
                        lines.append(f"    • {lbl} — Completed ({t_done} tasks done at {last_t})")
                elif now.hour >= 17:
                    lines.append("  <i>🌙 Operational window (09:00 - 17:00) has closed for today.</i>")
                else:
                    lines.append("  <i>No active task slots allocated yet today. Type /run to execute immediately.</i>")
            else:
                sorted_slots = sorted(task_slots, key=lambda x: x.get("scheduled_time", ""))
                for s in sorted_slots:
                    st = s.get("scheduled_time", "")
                    t_disp = st[11:16] if len(st) >= 16 else st
                    status = s.get("status", "scheduled")
                    status_icon = "⏳"
                    if status == "running":
                        status_icon = "⚙️"
                    elif status == "completed":
                        status_icon = "✅"
                    elif status == "failed":
                        status_icon = "❌"
                    label = s.get("label") or s.get("phone", "Account")
                    lines.append(f"  {status_icon} <b>{t_disp}</b> — {label} (<code>{status}</code>)")

            # 2. Withdrawals queue section
            lines.extend([
                "",
                "💸 <b>Withdrawal Queue (09:00 - 17:00 Mon-Fri):</b>"
            ])
            active_q = [q for q in q_items if q.get("status") in ("pending", "processing")]
            if not active_q:
                lines.append("  <i>No pending withdrawals in queue.</i>")
            else:
                for q in active_q:
                    q_time = q.get("scheduled_for", "")
                    t_disp = q_time[11:16] if len(q_time) >= 16 else q_time
                    amt = float(q.get("amount") or 0.0)
                    lbl = q.get("label") or q.get("phone", "Account")
                    st = q.get("status")
                    icon = "⚙️" if st == "processing" else "⏳"
                    lines.append(f"  {icon} <b>{t_disp}</b> — {lbl}: {amt:.2f} GHS [{st}]")

            # 3. Schedule Rules
            lines.extend([
                "",
                "ℹ️ <b>Operating Hours:</b>",
                "• <b>Tasks:</b> Mon - Sat, 09:00 - 17:00 (Randomized anti-pattern intervals)",
                "• <b>Withdrawals:</b> Mon - Fri, 09:00 - 17:00 (Randomized anti-clustering)"
            ])

            self.send_message("\n".join(lines))

        elif cmd in ["/status", "/balance"]:
            stats = db.get_dashboard_stats()
            accounts = db.get_accounts()
            now = db.utc_now().strftime("%Y-%m-%d %H:%M:%S")

            lines = [
                "📊 <b>Ace775 Status Overview</b>",
                f"🕒 <i>{now}</i>\n",
                f"👥 <b>Accounts:</b> {stats['active_accounts']} Active / {stats['total_accounts']} Total",
                f"✅ <b>Tasks Today:</b> {stats['tasks_completed_today']}",
                f"💰 <b>Total Earned Today:</b> +{stats['total_earned_today']:.2f} GHS\n",
                "<b>Account Breakdown:</b>"
            ]

            for a in accounts:
                is_enabled = bool(a.get("enabled", 1))
                status_icon = "🟢" if is_enabled else "⏸️ [PAUSED]"
                lines.append(
                    f"{status_icon} <b>{a['label'] or a['phone']}</b> (VIP {a['vip_level']})\n"
                    f"   💰 Balance: {a['balance']} GHS | Tasks: {a['tasks_done_today']} | Status: {a['last_status']}"
                )

            self.send_message("\n".join(lines))

        elif cmd == "/accounts":
            accounts = db.get_accounts()
            if not accounts:
                self.send_message("ℹ️ No accounts configured yet. Add them in the web dashboard.")
                return

            lines = ["📋 <b>Configured Accounts:</b>\n"]
            for a in accounts:
                is_enabled = bool(a.get("enabled", 1))
                active_str = "🟢 Active" if is_enabled else "⏸️ Paused"
                lines.append(
                    f"• <b>{a['label'] or 'Account'}</b> (<code>+233{a['phone']}</code>)\n"
                    f"   Mode: {a['mode'].upper()} | Status: {active_str} | Max Tasks: {a['max_tasks'] or 'All'}"
                )
            self.send_message("\n".join(lines))

        elif cmd == "/run":
            if db.utc_now().weekday() == 6:
                self.send_message("⏸️ <b>Today is Sunday (Rest Day)!</b>\nAce775 platform is closed for tasks on Sundays. Automated runs are suspended for the day.")
                return
            if self.run_all_callback:
                self.send_message("🚀 <b>Starting batch execution for all active accounts...</b>\nLogs will stream to your dashboard and you will receive a summary when finished.")
                # Trigger callback in background
                threading.Thread(target=self.run_all_callback, daemon=True).start()
            else:
                self.send_message("⚠️ Run worker not connected to Telegram listener.")

        else:
            self.send_message(f"❓ Unknown command: <code>{text}</code>. Type <b>/help</b> for commands.")

    def poll_loop(self):
        logger.info("Telegram command listener started.")
        while self.running:
            token, authorized_chat_id = self.get_token_and_chat()
            if not token or not authorized_chat_id:
                time.sleep(10)
                continue

            url = f"https://api.telegram.org/bot{token}/getUpdates"
            params = {"offset": self.last_update_id + 1, "timeout": 15}

            try:
                resp = requests.get(url, params=params, timeout=20)
                if resp.status_code == 200:
                    data = resp.json()
                    for update in data.get("result", []):
                        self.last_update_id = update["update_id"]
                        message = update.get("message")
                        if message and "text" in message:
                            sender_id = message["chat"]["id"]
                            text = message["text"]
                            self.handle_command(text, sender_id)
            except Exception as e:
                # brief pause on connection error
                time.sleep(5)

            time.sleep(1)

    def start(self):
        if not self.running:
            self.running = True
            self.thread = threading.Thread(target=self.poll_loop, daemon=True)
            self.thread.start()

    def stop(self):
        self.running = False


# Global bot listener instance
telegram_bot = TelegramCommandBot()
