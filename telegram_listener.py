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
                "• <b>/status</b> or <b>/balance</b> - View live account balances & today's earnings\n"
                "• <b>/run</b> - Trigger automation run for all active accounts\n"
                "• <b>/accounts</b> - List all configured accounts\n"
                "• <b>/help</b> - Show this message\n"
            )
            self.send_message(msg)

        elif cmd in ["/status", "/balance"]:
            stats = db.get_dashboard_stats()
            accounts = db.get_accounts()
            now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            lines = [
                "📊 <b>Ace775 Status Overview</b>",
                f"🕒 <i>{now}</i>\n",
                f"👥 <b>Accounts:</b> {stats['active_accounts']} Active / {stats['total_accounts']} Total",
                f"✅ <b>Tasks Today:</b> {stats['tasks_completed_today']}",
                f"💰 <b>Total Earned Today:</b> +{stats['total_earned_today']:.2f} GHS\n",
                "<b>Account Breakdown:</b>"
            ]

            for a in accounts:
                status_icon = "🟢" if a["enabled"] else "⚪"
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
                lines.append(
                    f"• <b>{a['label'] or 'Account'}</b> (<code>+233{a['phone']}</code>)\n"
                    f"   Mode: {a['mode'].upper()} | Active: {'Yes' if a['enabled'] else 'No'} | Max Tasks: {a['max_tasks'] or 'All'}"
                )
            self.send_message("\n".join(lines))

        elif cmd == "/run":
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
