"""
Smart Working Hours Auto-Scheduler & Auto-Retry Engine for Ace775
Runs batch automation at scheduled daytime hours and automatically retries when outside working hours.
"""

import os
import time
import random
import logging
import threading
from datetime import datetime, timedelta
from typing import Callable, Optional, Dict, Any

import db

logger = logging.getLogger("Scheduler")


class SmartScheduler:
    def __init__(self, run_all_callback: Optional[Callable] = None, broadcast_callback: Optional[Callable[[str, str], None]] = None):
        self.run_all_callback = run_all_callback
        self.broadcast_callback = broadcast_callback
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.last_scheduled_slot_1: Optional[str] = None
        self.last_scheduled_slot_2: Optional[str] = None
        self.retry_at: Optional[datetime] = None
        self.last_run_result: str = "Idle"

    def loop(self):
        logger.info("Smart Auto-Scheduler service started.")
        while self.running:
            try:
                enabled = db.get_setting("schedule_enabled", "1") == "1"
                sched_time = db.get_setting("schedule_time", "09:00").strip()
                sched_time_2 = db.get_setting("schedule_time_2", "").strip()
                auto_retry = db.get_setting("auto_retry_outside_hours", "1") == "1"
                retry_interval = int(db.get_setting("retry_interval_minutes", "30"))

                now = datetime.now()
                now_time_str = now.strftime("%H:%M")
                today_str = now.strftime("%Y-%m-%d")

                # Sunday Guard: Ace775 platform is closed for tasks on Sundays. Never trigger runs or retries.
                if now.weekday() == 6:
                    if self.retry_at:
                        logger.info("⏸️ Auto-Scheduler: Today is Sunday. Canceling queued retry. Platform is closed on Sundays.")
                        self.retry_at = None
                    time.sleep(60)
                    continue

                # 1. Check for scheduled daily run - Slot 1
                if enabled and sched_time and now_time_str == sched_time and self.last_scheduled_slot_1 != today_str:
                    logger.info(f"⏰ Auto-Scheduler: Triggering scheduled daily run (Slot 1) at {now_time_str}...")
                    self.last_scheduled_slot_1 = today_str
                    self.retry_at = None
                    if self.run_all_callback:
                        threading.Thread(target=self._run_with_retry_watch, daemon=True).start()

                # 2. Check for scheduled daily run - Slot 2 (Optional)
                elif enabled and sched_time_2 and now_time_str == sched_time_2 and self.last_scheduled_slot_2 != today_str:
                    logger.info(f"⏰ Auto-Scheduler: Triggering scheduled daily run (Slot 2) at {now_time_str}...")
                    self.last_scheduled_slot_2 = today_str
                    self.retry_at = None
                    if self.run_all_callback:
                        threading.Thread(target=self._run_with_retry_watch, daemon=True).start()

                # 3. Check for pending auto-retry
                elif self.retry_at and now >= self.retry_at and auto_retry:
                    logger.info(f"⏰ Auto-Scheduler: Executing queued retry after 'Outside working hours'...")
                    self.retry_at = None
                    if self.run_all_callback:
                        threading.Thread(target=self._run_with_retry_watch, daemon=True).start()

                # 4. Anti-clustering Withdrawal Queue Worker (Strictly 09:00 - 17:00, Mon-Sat)
                self._check_withdrawal_queue()

            except Exception as e:
                logger.error(f"Scheduler loop error: {e}")

            time.sleep(30)

    def _run_with_retry_watch(self):
        if not self.run_all_callback:
            return
        if datetime.now().weekday() == 6:
            logger.info("⏸️ Auto-Scheduler: Skipping run_all_callback. Today is Sunday (Rest day).")
            self.retry_at = None
            return

        results = self.run_all_callback()
        auto_retry = db.get_setting("auto_retry_outside_hours", "1") == "1"
        retry_interval = int(db.get_setting("retry_interval_minutes", "30"))

        # Check if accounts had "Outside working hours" (ignoring paused accounts)
        accounts = db.get_accounts()
        outside_hours = any("working hours" in (a.get("last_status") or "").lower() for a in accounts if a.get("enabled", 1))

        if outside_hours and auto_retry and datetime.now().weekday() != 6:
            self.retry_at = datetime.now() + timedelta(minutes=retry_interval)
            retry_str = self.retry_at.strftime("%H:%M:%S")
            logger.info(f"⏰ Outside working hours detected. Auto-retry scheduled at {retry_str} (in {retry_interval}m).")
        else:
            self.retry_at = None

    def _check_withdrawal_queue(self):
        """Processes any queued withdrawal that is due for execution within 09:00 - 17:00 (Mon-Sat)."""
        now = datetime.now()
        # Ace775 operates strictly Mon-Sat between 09:00 and 17:00
        if now.weekday() == 6:
            return
        if now.hour < 9 or now.hour >= 17:
            return

        item = db.get_due_withdrawal()
        if not item:
            return

        queue_id = item["id"]
        account_id = item["account_id"]
        amount = float(item["amount"])
        wallet_flag = int(item.get("wallet_flag", 2))
        pay_password = item.get("pay_password", "")
        phone = item.get("phone", "")
        label = item.get("label") or phone

        # Mark item as processing immediately to prevent duplicate pickup
        db.update_queue_item_status(queue_id, "processing")
        if self.broadcast_callback:
            self.broadcast_callback(
                f"⚙️ [Withdrawal Queue] Slot reached! Executing queued withdrawal #{queue_id} for '{label}' ({amount:.2f} GHS)...",
                "info"
            )

        try:
            from ace_bot import AceApiBot, TelegramReporter

            account = db.get_account(account_id, decrypt=True)
            if not account:
                msg = f"Account #{account_id} not found in database"
                db.update_queue_item_status(queue_id, "failed", msg)
                if self.broadcast_callback:
                    self.broadcast_callback(f"❌ [Withdrawal Queue] {msg}", "error")
                return

            if account.get("enabled", 1) == 0:
                msg = f"Account '{label}' is paused. Withdrawal aborted."
                db.update_queue_item_status(queue_id, "failed", msg)
                if self.broadcast_callback:
                    self.broadcast_callback(f"⏸️ [Withdrawal Queue] {msg}", "warning")
                return

            # Check daily limit: max 1 completed withdrawal per day
            today_str = now.strftime("%Y-%m-%d")
            if account.get("last_withdraw_date") == today_str:
                msg = f"Account '{label}' already completed a withdrawal today ({today_str}). Maximum 1 withdrawal per day allowed."
                db.update_queue_item_status(queue_id, "failed", msg)
                if self.broadcast_callback:
                    self.broadcast_callback(f"⏸️ [Withdrawal Queue] {msg}", "warning")
                return

            pwd = account.get("password", "")
            base_url = db.get_setting("base_url", "https://ace775.com")

            bot = AceApiBot(base_url=base_url, phone=phone, password=pwd)
            if not bot.login():
                err_msg = bot.stats.get("error", "Login failed")
                if err_msg.startswith("Login failed: "):
                    err_msg = err_msg[14:]
                db.update_queue_item_status(queue_id, "failed", f"Login failed: {err_msg}")
                if self.broadcast_callback:
                    self.broadcast_callback(f"❌ [Withdrawal Queue] Login failed for '{label}': {err_msg}", "error")
                return

            # Re-verify live wallet balance
            inc_bal = float(bot.stats.get("income_balance") or 0.0)
            pers_bal = float(bot.stats.get("personal_balance") or 0.0)
            avail_bal = inc_bal if wallet_flag == 2 else pers_bal
            if avail_bal <= 0:
                avail_bal = float(bot.stats.get("balance") or 0.0)

            wallet_name = "Income Wallet" if wallet_flag == 2 else "Personal Wallet"

            if avail_bal < amount:
                msg = f"Insufficient funds: {wallet_name} balance ({avail_bal:.2f} GHS) < requested {amount:.2f} GHS"
                db.update_queue_item_status(queue_id, "failed", msg)
                if self.broadcast_callback:
                    self.broadcast_callback(f"❌ [Withdrawal Queue] '{label}': {msg}", "error")
                return

            tg_token = db.get_setting("telegram_token", os.getenv("TELEGRAM_BOT_TOKEN", ""))
            tg_chat = db.get_setting("telegram_chat_id", os.getenv("TELEGRAM_CHAT_ID", ""))
            reporter = TelegramReporter(bot_token=tg_token, chat_id=tg_chat)

            # Submit withdrawal via Ace775 API
            res = bot.apply_withdrawal(amount=amount, pay_password=pay_password, withdrawl_flag=wallet_flag)
            if res.get("success"):
                success_msg = f"Submitted {amount:.2f} GHS"
                db.update_queue_item_status(queue_id, "completed", success_msg)
                db.update_account_withdrawal_status(account_id, status=success_msg)
                db.update_account_stats(
                    account_id,
                    balance=bot.stats.get("balance"),
                    income_balance=bot.stats.get("income_balance"),
                    personal_balance=bot.stats.get("personal_balance")
                )
                if self.broadcast_callback:
                    self.broadcast_callback(f"✅ [Withdrawal Queue] Success for '{label}': {success_msg}", "success")
                if reporter.is_configured:
                    reporter.send_withdrawal_alert(label, phone, amount, "Submitted Successfully (Queue)", res.get("message", ""))
            else:
                fail_msg = f"Failed: {res.get('message', 'API error')}"
                db.update_queue_item_status(queue_id, "failed", fail_msg)
                db.update_account_withdrawal_status(account_id, status=fail_msg)
                if self.broadcast_callback:
                    self.broadcast_callback(f"❌ [Withdrawal Queue] Failed for '{label}': {fail_msg}", "error")
                if reporter.is_configured:
                    reporter.send_withdrawal_alert(label, phone, amount, "Failed (Queue)", fail_msg)

        except Exception as e:
            logger.error(f"Error executing queued withdrawal #{queue_id}: {e}", exc_info=True)
            db.update_queue_item_status(queue_id, "failed", f"Exception: {str(e)[:100]}")
            if self.broadcast_callback:
                self.broadcast_callback(f"❌ [Withdrawal Queue] Error processing #{queue_id} for '{label}': {e}", "error")

    def get_status(self) -> Dict[str, Any]:
        enabled = db.get_setting("schedule_enabled", "1") == "1"
        sched_time = db.get_setting("schedule_time", "09:00").strip()
        sched_time_2 = db.get_setting("schedule_time_2", "").strip()
        retry_interval = int(db.get_setting("retry_interval_minutes", "30"))

        status_text = "Disabled"
        if enabled:
            if datetime.now().weekday() == 6:
                status_text = "Sunday: Platform Closed (Rest Day)"
            elif self.retry_at:
                status_text = f"Retrying at {self.retry_at.strftime('%H:%M')}"
            elif sched_time_2:
                status_text = f"Active ({sched_time}, {sched_time_2})"
            else:
                status_text = f"Active ({sched_time})"

        return {
            "enabled": enabled,
            "schedule_time": sched_time,
            "schedule_time_2": sched_time_2,
            "retry_scheduled": bool(self.retry_at),
            "retry_at": self.retry_at.strftime("%H:%M:%S") if self.retry_at else None,
            "retry_interval_minutes": retry_interval,
            "status_text": status_text
        }

    def start(self):
        if not self.running:
            self.running = True
            self.thread = threading.Thread(target=self.loop, daemon=True)
            self.thread.start()

    def stop(self):
        self.running = False


# Global scheduler instance
scheduler = SmartScheduler()
