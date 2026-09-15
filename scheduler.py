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

# Shared window helpers (aliased so the allocator below stays self-contained).
min_to_hhmm = db.min_to_hhmm
hhmm_to_min = db.hhmm_to_min

logger = logging.getLogger("Scheduler")



# ==============================================================================
# Per-account time windows
# ==============================================================================
def merge_windows(intervals):
    """Union overlapping (start, end) intervals so overlapping windows are spaced together."""
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def plan_task_slots(entries, now_min, spacing, duration, cutoff_min, policy="late"):
    """Pure allocator: place every account's run inside its own window without clustering.

    entries: [{"id", "label", "phone", "start", "end"}] with start/end in minutes from midnight
    Returns {"slots": [...], "clusters": [...], "problems": [...], "skipped": [...]}.

    Rules:
      * overlapping windows are merged into one cluster and spaced together
      * capacity of a cluster is (length - duration) / spacing + 1; overflow is reported,
        never silently relocated
      * a slot must start and finish inside its own window
      * windows that have already closed are run late (policy="late"), up to cutoff_min
    """
    slots, problems, skipped = [], [], []
    day_end = min(24 * 60, cutoff_min)

    in_window, closed = [], []
    for e in entries:
        (closed if e["end"] <= now_min else in_window).append(e)

    latest_start = day_end - duration
    for idx, e in enumerate(sorted(closed, key=lambda x: (x["start"], x["end"]))):
        if policy != "late":
            skipped.append({"account_id": e["id"], "label": e["label"],
                            "reason": "window already closed"})
            continue
        # Stagger late runs by the same spacing, otherwise every missed account would fire
        # in the same tick and cluster.
        start = now_min + idx * spacing
        if start > latest_start:
            skipped.append({"account_id": e["id"], "label": e["label"],
                            "reason": "past the %s cutoff for today" % min_to_hhmm(day_end)})
            continue
        slots.append({"account_id": e["id"], "label": e["label"], "phone": e.get("phone", ""),
                      "start": start, "late": True, "source": e.get("source", "")})

    clusters = merge_windows([(e["start"], e["end"]) for e in in_window])
    for cluster_start, cluster_end in clusters:
        members = sorted([e for e in in_window if e["start"] < cluster_end and e["end"] > cluster_start],
                         key=lambda e: (e["start"], e["end"]))
        if not members:
            continue
        capacity = (cluster_end - cluster_start - duration) // spacing + 1
        needed = (len(members) - 1) * spacing + duration
        if len(members) > capacity:
            problems.append({
                "kind": "capacity",
                "window": "%s-%s" % (min_to_hhmm(cluster_start), min_to_hhmm(cluster_end)),
                "accounts": [m["label"] for m in members],
                "capacity": capacity,
                "needed_minutes": needed,
                "message": ("%s-%s holds %d account(s) at %d min spacing, but %d are queued "
                            "(%s) - needs %d min (widen by %d min or lower the spacing)"
                            % (min_to_hhmm(cluster_start), min_to_hhmm(cluster_end), capacity, spacing,
                               len(members), ", ".join(m["label"] for m in members),
                               needed, max(0, needed - (cluster_end - cluster_start)))),
            })
            continue

        # Pass 1: earliest-feasible packing. This proves the cluster really fits and gives
        # every run the room it needs. Picking slots at random here would let an early
        # account consume the space a later one depends on.
        starts = []
        cursor = cluster_start
        infeasible = None
        for idx, member in enumerate(members):
            gap = spacing if idx else 0          # spacing applies BETWEEN runs, not before the first
            start = max(cursor + gap, member["start"])
            if start + duration > member["end"] or start + duration > cluster_end:
                infeasible = member
                break
            starts.append(start)
            cursor = start

        if infeasible is not None:
            problems.append({
                "kind": "no_room",
                "account": infeasible["label"],
                "message": ("'%s' has no room left in %s-%s once the accounts before it are placed"
                            % (infeasible["label"], min_to_hhmm(infeasible["start"]),
                               min_to_hhmm(infeasible["end"]))),
            })
            continue

        # Pass 2: jitter each run inside its own slack, never breaking spacing or the window.
        for idx, member in enumerate(members):
            lower = starts[idx]
            if idx + 1 < len(members):
                upper = min(member["end"] - duration, starts[idx + 1] - spacing)
            else:
                upper = min(member["end"] - duration, cluster_end - duration)
            upper = max(lower, upper)
            slot = random.randint(lower, upper)
            slots.append({"account_id": member["id"], "label": member["label"],
                          "phone": member.get("phone", ""), "start": slot, "late": False,
                          "source": member.get("source", "")})

    slots.sort(key=lambda s: s["start"])
    return {"slots": slots, "clusters": [[a, b] for a, b in clusters],
            "problems": problems, "skipped": skipped}


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
        # New attribute to track if the midnight‑generated start has been triggered today
        self.last_midnight_start_date: Optional[str] = None
        self.last_task_schedule_date: Optional[str] = None
        self.last_briefing_date: Optional[str] = None
        self.last_evening_digest_date: Optional[str] = None

        # Restore today's task schedule from persistent database if previously generated
        try:
            today_str = db.utc_now().strftime("%Y-%m-%d")
            saved = db.get_daily_task_schedule(today_str)
            if saved:
                for item in saved:
                    self.daily_task_schedule[item["account_id"]] = item
                self.last_task_schedule_date = today_str
                self.last_briefing_date = today_str
                logger.info(f"Loaded {len(saved)} saved task slots from database for {today_str}.")
        except Exception as e:
            logger.warning(f"Failed to restore saved daily task schedule: {e}")

    def ensure_schedule(self, force_refresh: bool = False):
        """Public method to dynamically ensure schedule is generated (e.g. for /today command)."""
        now = db.utc_now()
        today_str = now.strftime("%Y-%m-%d")
        if force_refresh:
            self.last_task_schedule_date = None
        self._ensure_midnight_task_schedule(now, today_str)

    def loop(self):
        logger.info("Smart Auto-Scheduler service started.")
        while self.running:
            try:
                enabled = db.get_setting("schedule_enabled", "1") == "1"
                sched_time = db.get_setting("schedule_time", "09:00").strip()
                sched_time_2 = db.get_setting("schedule_time_2", "").strip()
                auto_retry = db.get_setting("auto_retry_outside_hours", "1") == "1"
                retry_interval = int(db.get_setting("retry_interval_minutes", "30"))
                midnight_enabled = db.get_setting("midnight_scheduler_enabled", "1") == "1"

                now = db.utc_now()
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

                # 0. Ensure daily counters in database are reset for the new calendar day
                db.check_and_reset_daily_stats()

                # 1. Midnight Pattern-Free Task Allocation Engine (Monday - Saturday)
                self._ensure_midnight_task_schedule(now, today_str)

                # 2. Check and dispatch due task allocations
                self._check_due_task_slots(now)

                # 3. Scheduled Fixed Slot Triggers (Only if explicit fixed slot configured and midnight scheduler disabled)
                if not midnight_enabled and enabled and sched_time and now_time_str == sched_time and self.last_scheduled_slot_1 != today_str:
                    logger.info(f"⏰ Auto-Scheduler: Triggering legacy fixed batch run (Slot 1) at {now_time_str}...")
                    self.last_scheduled_slot_1 = today_str
                    self.retry_at = None
                    if self.run_all_callback:
                        threading.Thread(target=self._run_batch_and_watch, daemon=True).start()

                elif not midnight_enabled and enabled and sched_time_2 and now_time_str == sched_time_2 and self.last_scheduled_slot_2 != today_str:
                    logger.info(f"⏰ Auto-Scheduler: Triggering legacy fixed batch run (Slot 2) at {now_time_str}...")
                    self.last_scheduled_slot_2 = today_str
                    self.retry_at = None
                    if self.run_all_callback:
                        threading.Thread(target=self._run_with_retry_watch, daemon=True).start()

                # 5. Check for pending auto-retry
                elif self.retry_at and now >= self.retry_at and auto_retry:
                    self.retry_at = None
                    threading.Thread(target=self._retry_affected_accounts, daemon=True).start()

                # 6. Anti-clustering Withdrawal Queue Worker (Strictly 09:00 - 17:00, Mon-Fri)
                self._check_withdrawal_queue()

                # 7. Daily Evening Financial Digest (18:00 daily after withdrawal window closes)
                self._check_evening_digest(now, today_str)

            except Exception as e:
                logger.error(f"Scheduler loop error: {e}")

            time.sleep(30)

    def _run_batch_and_watch(self):
        if not self.run_all_callback:
            return
        if db.utc_now().weekday() == 6:
            logger.info("⏸️ Auto-Scheduler: Skipping run_all_callback. Today is Sunday (Rest day).")
            self.retry_at = None
            return

        results = self.run_all_callback()
        auto_retry = db.get_setting("auto_retry_outside_hours", "1") == "1"
        retry_interval = int(db.get_setting("retry_interval_minutes", "30"))

        # Check if accounts had "Outside working hours" (ignoring paused accounts)
        accounts = db.get_accounts()
        outside_hours = any("working hours" in (a.get("last_status") or "").lower() for a in accounts if a.get("enabled", 1))

        if outside_hours and auto_retry and db.utc_now().weekday() != 6:
            self.retry_at = db.utc_now() + timedelta(minutes=retry_interval)
            retry_str = self.retry_at.strftime("%H:%M:%S")
            logger.info(f"⏰ Outside working hours detected. Auto-retry scheduled at {retry_str} (in {retry_interval}m).")
        else:
            self.retry_at = None

    def _retry_affected_accounts(self):
        """Retry ONLY the accounts that hit a closed-window response.

        The old behaviour called run_all_callback(), which ignored the per-account windows
        and re-ran the entire batch the moment a retry fell due.
        """
        now = db.utc_now()
        if now.weekday() == 6:
            logger.info("Auto-Scheduler: Sunday rest day, no retry.")
            self.retry_at = None
            return

        auto_retry = db.get_setting("auto_retry_outside_hours", "1") == "1"
        retry_interval = int(db.get_setting("retry_interval_minutes", "30"))
        cutoff = db.hhmm_to_min(db.get_setting("late_run_cutoff", "23:00")) or 23 * 60
        if now.hour * 60 + now.minute >= cutoff:
            logger.info("Auto-Scheduler: past the %s cutoff, no retry today." % db.min_to_hhmm(cutoff))
            self.retry_at = None
            return

        markers = ("working hours", "closed", "forbid", "not open")
        def blocked(account):
            status = (account.get("last_status") or "").lower()
            return account.get("enabled", 1) and any(m in status for m in markers)

        affected = [a for a in db.get_accounts() if blocked(a)]
        if not affected:
            self.retry_at = None
            return

        labels = ", ".join("'%s'" % (a.get("label") or a["phone"]) for a in affected)
        msg = ("Auto-Scheduler: retrying %d account(s) that hit a closed-window response: %s"
               % (len(affected), labels))
        logger.info(msg)
        if self.broadcast_callback:
            self.broadcast_callback(msg, "info")

        gap_min = max(1, int(db.get_setting("min_task_spacing_minutes", "15") or "15"))
        gap_max = max(gap_min, int(db.get_setting("max_task_spacing_minutes", "35") or "35"))
        for idx, account in enumerate(affected):
            try:
                if self.run_single_callback:
                    self.run_single_callback(account["id"])
            except Exception as exc:
                logger.error("Retry failed for account #%s: %s" % (account["id"], exc))
            if idx < len(affected) - 1:
                time.sleep(random.randint(gap_min, gap_max) * 60)

        still = [a for a in db.get_accounts() if blocked(a)]
        if still and auto_retry:
            self.retry_at = db.utc_now() + timedelta(minutes=retry_interval)
            logger.info("Auto-Scheduler: %d account(s) still blocked, next retry at %s."
                        % (len(still), self.retry_at.strftime("%H:%M:%S")))
        else:
            self.retry_at = None
            logger.info("Auto-Scheduler: retry complete, no accounts still blocked.")

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
            target_tasks = int(a.get("max_tasks") or 0)
            
            if target_tasks > 0:
                is_done = ("completed" in status or tasks_done >= target_tasks)
            else:
                is_done = ("completed" in status)
            
            if last_run.startswith(today_str) and is_done:
                continue
            pending_accounts.append(a)

        if not pending_accounts:
            self.last_task_schedule_date = today_str
            return

        # Every account runs inside its own window. Overlapping windows are merged into one
        # cluster and spaced together; an overflowing cluster is reported, never relocated.
        if self.last_task_schedule_date != today_str:
            self.daily_task_schedule.clear()

        entries = []
        for a in pending_accounts:
            acc_id = a["id"]
            existing = self.daily_task_schedule.get(acc_id)
            if existing and existing["status"] in ("completed", "running"):
                continue
            start_min, end_min, source = db.resolve_window(a)
            entries.append({
                "id": acc_id,
                "label": a.get("label") or a["phone"],
                "phone": a["phone"],
                "start": start_min,
                "end": end_min,
                "source": source,
            })

        duration = int(db.get_setting("slot_duration_minutes", "10") or "10")
        cutoff = db.hhmm_to_min(db.get_setting("late_run_cutoff", "23:00")) or 23 * 60
        policy = db.get_setting("missed_window_policy", "late")

        plan = plan_task_slots(entries, now.hour * 60 + now.minute, min_spacing, duration, cutoff, policy)

        schedule_summary = []
        for slot in plan["slots"]:
            acc_id = slot["account_id"]
            start_dt = now.replace(hour=slot["start"] // 60, minute=slot["start"] % 60,
                                   second=random.randint(0, 59), microsecond=0)
            self.daily_task_schedule[acc_id] = {
                "account_id": acc_id,
                "label": slot["label"],
                "phone": slot["phone"],
                "scheduled_time": start_dt.strftime("%Y-%m-%d %H:%M:%S"),
                "status": "scheduled",
            }
            schedule_summary.append("'%s' at %s%s" % (slot["label"], db.min_to_hhmm(slot["start"]),
                                                      " (late)" if slot["late"] else ""))

        for problem in plan["problems"]:
            logger.warning("[Task Windows] %s" % problem["message"])
            if self.broadcast_callback:
                self.broadcast_callback("Time window: %s" % problem["message"], "warning")
        for skip in plan["skipped"]:
            logger.warning("[Task Windows] '%s' skipped: %s" % (skip["label"], skip["reason"]))
            if self.broadcast_callback:
                self.broadcast_callback("Time window: '%s' was not scheduled - %s" % (skip["label"], skip["reason"]),
                                        "warning")

        self.last_task_schedule_date = today_str

        if self.daily_task_schedule:
            db.save_daily_task_schedule(list(self.daily_task_schedule.values()), today_str)

        if schedule_summary:
            msg = f"🌙 [Midnight Scheduler] Pattern-free task schedule allocated for today: {', '.join(schedule_summary)}."
            logger.info(msg)
            if self.broadcast_callback:
                self.broadcast_callback(msg, "info")

            # Dispatch Daily Telegram Schedule Briefing once per day (mark only on verified send)
            if self.last_briefing_date != today_str:
                ok = self._send_telegram_schedule_briefing(today_str)
                if ok:
                    self.last_briefing_date = today_str

    def _send_telegram_schedule_briefing(self, today_str: str) -> bool:
        """Sends morning/midnight operations briefing to Telegram."""
        try:
            tg_token = db.get_setting("telegram_token", os.getenv("TELEGRAM_BOT_TOKEN", ""))
            tg_chat = db.get_setting("telegram_chat_id", os.getenv("TELEGRAM_CHAT_ID", ""))
            from ace_bot import TelegramReporter
            reporter = TelegramReporter(bot_token=tg_token, chat_id=tg_chat)
            if reporter.is_configured and self.daily_task_schedule:
                formatted_date = datetime.strptime(today_str, "%Y-%m-%d").strftime("%A, %b %d, %Y")
                ok = reporter.send_daily_schedule_briefing(list(self.daily_task_schedule.values()), formatted_date)
                if ok:
                    logger.info(f"📱 Sent daily operations briefing to Telegram for {today_str}.")
                    return True
                else:
                    logger.warning(f"Telegram rejected daily schedule briefing for {today_str}.")
                    return False
        except Exception as e:
            logger.error(f"Failed to dispatch daily Telegram schedule briefing: {e}")
            return False
        return False

    def _check_evening_digest(self, now: datetime, today_str: str):
        """Dispatches evening financial summary at 18:00 after withdrawal window closes."""
        if now.hour != 18 or self.last_evening_digest_date == today_str:
            return

        tg_token = db.get_setting("telegram_token", os.getenv("TELEGRAM_BOT_TOKEN", ""))
        tg_chat = db.get_setting("telegram_chat_id", os.getenv("TELEGRAM_CHAT_ID", ""))
        from ace_bot import TelegramReporter
        reporter = TelegramReporter(bot_token=tg_token, chat_id=tg_chat)
        if not reporter.is_configured:
            self.last_evening_digest_date = today_str
            return

        try:
            stats = db.get_dashboard_stats()
            accounts = db.get_accounts(mask_passwords=True)
            q_items = db.get_withdrawal_queue()

            today_completed_w = [
                q for q in q_items
                if q.get("status") == "completed" and (q.get("created_at") or "").startswith(today_str)
            ]
            queued_w = [q for q in q_items if q.get("status") in ("pending", "processing")]

            comp_w_amount = sum(float(q.get("amount") or 0.0) for q in today_completed_w)
            queued_w_amount = sum(float(q.get("amount") or 0.0) for q in queued_w)

            total_portfolio_balance = sum(float(a.get("balance") or 0.0) for a in accounts)
            total_income_balance = sum(float(a.get("income_balance") or 0.0) for a in accounts)
            total_personal_balance = sum(float(a.get("personal_balance") or 0.0) for a in accounts)

            summary = {
                "date_str": now.strftime("%A, %b %d, %Y"),
                "tasks_completed_today": stats.get("tasks_completed_today", 0),
                "total_earned_today": stats.get("total_earned_today", 0.0),
                "total_portfolio_balance": total_portfolio_balance,
                "total_income_balance": total_income_balance,
                "total_personal_balance": total_personal_balance,
                "withdrawals_completed_count": len(today_completed_w),
                "withdrawals_completed_amount": comp_w_amount,
                "withdrawals_queued_count": len(queued_w),
                "withdrawals_queued_amount": queued_w_amount,
                "accounts": accounts
            }

            reporter.send_daily_financial_digest(summary)
            logger.info("📊 Daily evening financial digest sent to Telegram.")
            self.last_evening_digest_date = today_str
        except Exception as e:
            logger.error(f"Failed to send evening financial digest: {e}")

    def _check_due_task_slots(self, now: datetime):
        """Dispatches tasks for accounts whose randomized time slot has arrived."""
        if not self.run_single_callback:
            return
        if now.weekday() == 6:
            return

        now_str = now.strftime("%Y-%m-%d %H:%M:%S")
        cutoff = db.hhmm_to_min(db.get_setting("late_run_cutoff", "23:00")) or 23 * 60
        if now.hour * 60 + now.minute > cutoff:
            # Past close of day: any slot still waiting is dropped (it runs again tomorrow).
            for acc_id, slot_info in list(self.daily_task_schedule.items()):
                if slot_info["status"] == "scheduled":
                    slot_info["status"] = "skipped"
                    db.update_daily_task_slot_status(acc_id, "skipped")
            return
        for acc_id, slot_info in list(self.daily_task_schedule.items()):
            if slot_info["status"] == "scheduled" and now_str >= slot_info["scheduled_time"]:
                slot_info["status"] = "running"
                db.update_daily_task_slot_status(acc_id, "running")
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
                        db.update_daily_task_slot_status(target_id, "completed")
                    except Exception as ex:
                        logger.error(f"Error in scheduled task run for account #{target_id}: {ex}")
                        info["status"] = "failed"
                        db.update_daily_task_slot_status(target_id, "failed")

                threading.Thread(target=_run_worker, daemon=True).start()

    def _check_withdrawal_queue(self):
        """Processes any queued withdrawal that is due for execution within 09:00 - 17:00 (Mon-Fri)."""
        now = db.utc_now()
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
                tg_token = db.get_setting("telegram_token", os.getenv("TELEGRAM_BOT_TOKEN", ""))
                tg_chat = db.get_setting("telegram_chat_id", os.getenv("TELEGRAM_CHAT_ID", ""))
                reporter = TelegramReporter(bot_token=tg_token, chat_id=tg_chat)
                if reporter.is_configured:
                    reporter.send_account_health_alert(label, phone, "Withdrawal Login Failed (Invalid Credentials)", err_msg)
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
        if db.utc_now().weekday() == 6:
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
