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
    def __init__(self, run_all_callback: Optional[Callable] = None,
                 run_single_callback: Optional[Callable[[int], None]] = None,
                 broadcast_callback: Optional[Callable[[str, str], None]] = None):
        self.run_all_callback = run_all_callback
        self.run_single_callback = run_single_callback
        self.broadcast_callback = broadcast_callback
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.last_scheduled_slot_1: Optional[str] = None
        self.last_scheduled_slot_2: Optional[str] = None
        self.retry_at: Optional[datetime] = None
        self.last_run_result: str = "Idle"
        # Midnight Pattern-Free Task Allocation Engine
        self.daily_task_schedule: Dict[int, Dict[str, Any]] = {}
        self.last_task_schedule_date: Optional[str] = None

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
                    if self.daily_task_schedule:
                        self.daily_task_schedule.clear()
                    time.sleep(60)
                    continue

                # 1. Midnight Pattern-Free Task Allocation Engine (Monday - Saturday)
                self._ensure_midnight_task_schedule(now, today_str)

                # 2. Check and dispatch due task allocations
                self._check_due_task_slots(now)

                # 3. Check for scheduled daily run - Slot 1 (Optional fixed batch trigger)
                if enabled and sched_time and now_time_str == sched_time and self.last_scheduled_slot_1 != today_str:
                    logger.info(f"⏰ Auto-Scheduler: Triggering scheduled daily run (Slot 1) at {now_time_str}...")
                    self.last_scheduled_slot_1 = today_str
                    self.retry_at = None
                    if self.run_all_callback:
                        threading.Thread(target=self._run_with_retry_watch, daemon=True).start()

                # 4. Check for scheduled daily run - Slot 2 (Optional fixed batch trigger)
                elif enabled and sched_time_2 and now_time_str == sched_time_2 and self.last_scheduled_slot_2 != today_str:
                    logger.info(f"⏰ Auto-Scheduler: Triggering scheduled daily run (Slot 2) at {now_time_str}...")
                    self.last_scheduled_slot_2 = today_str
                    self.retry_at = None
                    if self.run_all_callback:
                        threading.Thread(target=self._run_with_retry_watch, daemon=True).start()

                # 5. Check for pending auto-retry
                elif self.retry_at and now >= self.retry_at and auto_retry:
                    logger.info(f"⏰ Auto-Scheduler: Executing queued retry after 'Outside working hours'...")
                    self.retry_at = None
                    if self.run_all_callback:
                        threading.Thread(target=self._run_with_retry_watch, daemon=True).start()

                # 6. Anti-clustering Withdrawal Queue Worker (Strictly 09:00 - 17:00, Mon-Fri)
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

    def _ensure_midnight_task_schedule(self, now: datetime, today_str: str):
        """
        Allocates randomized, pattern-free task execution times for active accounts.
        Runs daily starting from midnight (Monday - Saturday).
        """
        midnight_enabled = db.get_setting("midnight_scheduler_enabled", "1") == "1"
        if not midnight_enabled:
            return

        # If schedule already generated today, check if any newly added accounts need a slot
        if self.last_task_schedule_date == today_str and self.daily_task_schedule:
            accounts = db.get_accounts(mask_passwords=False)
            unallocated = [
                a for a in accounts
                if a.get("enabled", 1) and a["id"] not in self.daily_task_schedule
            ]
            if not unallocated:
                return

        min_spacing = int(db.get_setting("min_task_spacing_minutes", "15") or "15")
        max_spacing = int(db.get_setting("max_task_spacing_minutes", "35") or "35")
        if min_spacing > max_spacing:
            min_spacing, max_spacing = max_spacing, min_spacing

        accounts = db.get_accounts(mask_passwords=False)
        active_accounts = [a for a in accounts if a.get("enabled", 1)]
        if not active_accounts:
            return

        # Filter out accounts that already completed tasks today
        pending_accounts = []
        for a in active_accounts:
            last_run = a.get("last_run_time") or ""
            tasks_done = int(a.get("tasks_done_today") or 0)
            status = (a.get("last_status") or "").lower()
            if last_run.startswith(today_str) and ("completed" in status or tasks_done >= 5):
                continue
            pending_accounts.append(a)

        if not pending_accounts:
            self.last_task_schedule_date = today_str
            return

        # Pattern-free randomization: Shuffle accounts so execution order is NEVER fixed
        random.shuffle(pending_accounts)

        # Base time: If running during midnight/early hours (00:00 - 05:00), stagger starting shortly after 00:05
        if now.hour < 5:
            base_dt = max(now, now.replace(hour=0, minute=random.randint(5, 18), second=random.randint(0, 59)))
        else:
            base_dt = now + timedelta(minutes=random.randint(2, 6), seconds=random.randint(0, 59))

        if self.last_task_schedule_date != today_str:
            self.daily_task_schedule.clear()

        schedule_summary = []
        for a in pending_accounts:
            acc_id = a["id"]
            if acc_id in self.daily_task_schedule and self.daily_task_schedule[acc_id]["status"] in ("completed", "running"):
                continue

            step_mins = random.randint(min_spacing, max_spacing)
            step_secs = random.randint(0, 59)
            base_dt = base_dt + timedelta(minutes=step_mins, seconds=step_secs)

            slot_str = base_dt.strftime("%Y-%m-%d %H:%M:%S")
            label = a.get("label") or a["phone"]
            self.daily_task_schedule[acc_id] = {
                "account_id": acc_id,
                "label": label,
                "phone": a["phone"],
                "scheduled_time": slot_str,
                "status": "scheduled"
            }
            time_display = base_dt.strftime("%H:%M:%S")
            schedule_summary.append(f"'{label}' at {time_display}")

        self.last_task_schedule_date = today_str

        if schedule_summary:
            msg = f"🌙 [Midnight Scheduler] Pattern-free task schedule allocated for today: {', '.join(schedule_summary)}."
            logger.info(msg)
            if self.broadcast_callback:
                self.broadcast_callback(msg, "info")

    def _check_due_task_slots(self, now: datetime):
        """Dispatches tasks for accounts whose randomized time slot has arrived."""
        if not self.run_single_callback:
            return
        if now.weekday() == 6:
            return

        now_str = now.strftime("%Y-%m-%d %H:%M:%S")
        for acc_id, slot_info in list(self.daily_task_schedule.items()):
            if slot_info["status"] == "scheduled" and now_str >= slot_info["scheduled_time"]:
                slot_info["status"] = "running"
                label = slot_info["label"]
                sched_display = slot_info["scheduled_time"][11:16]
                msg = f"⏰ [Midnight Scheduler] Slot reached ({sched_display})! Launching daily tasks for '{label}'..."
                logger.info(msg)
                if self.broadcast_callback:
                    self.broadcast_callback(msg, "info")

                def _run_worker(target_id=acc_id, info=slot_info):
                    try:
                        self.run_single_callback(target_id)
                        info["status"] = "completed"
                    except Exception as ex:
                        logger.error(f"Error in scheduled task run for account #{target_id}: {ex}")
                        info["status"] = "failed"

                threading.Thread(target=_run_worker, daemon=True).start()

    def _check_withdrawal_queue(self):
        """Processes any queued withdrawal that is due for execution within 09:00 - 17:00 (Mon-Fri)."""
        now = datetime.now()
        # Ace775 operates withdrawals strictly Mon-Fri between 09:00 and 17:00
        if now.weekday() in (5, 6):
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
        midnight_enabled = db.get_setting("midnight_scheduler_enabled", "1") == "1"

        # Find next upcoming midnight task slot
        next_task_info = None
        for aid, info in sorted(self.daily_task_schedule.items(), key=lambda x: x[1]["scheduled_time"]):
            if info["status"] == "scheduled":
                next_task_info = info
                break

        status_text = "Disabled"
        if datetime.now().weekday() == 6:
            status_text = "Sunday: Platform Closed (Rest Day)"
        elif self.retry_at:
            status_text = f"Retrying at {self.retry_at.strftime('%H:%M')}"
        elif midnight_enabled and next_task_info:
            time_str = next_task_info["scheduled_time"][11:16]
            label_str = next_task_info["label"]
            status_text = f"Midnight Scheduler: Next '{label_str}' at {time_str}"
        elif enabled:
            if sched_time_2:
                status_text = f"Active ({sched_time}, {sched_time_2})"
            else:
                status_text = f"Active ({sched_time})"

        return {
            "enabled": enabled,
            "midnight_enabled": midnight_enabled,
            "schedule_time": sched_time,
            "schedule_time_2": sched_time_2,
            "retry_scheduled": bool(self.retry_at),
            "retry_at": self.retry_at.strftime("%H:%M:%S") if self.retry_at else None,
            "retry_interval_minutes": retry_interval,
            "status_text": status_text,
            "daily_task_schedule": list(self.daily_task_schedule.values()),
            "next_task": next_task_info
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
