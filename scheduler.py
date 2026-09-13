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
    def __init__(self, run_all_callback: Optional[Callable] = None):
        self.run_all_callback = run_all_callback
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.last_scheduled_date: Optional[str] = None
        self.retry_at: Optional[datetime] = None
        self.last_run_result: str = "Idle"

    def loop(self):
        logger.info("Smart Auto-Scheduler service started.")
        while self.running:
            try:
                enabled = db.get_setting("schedule_enabled", "1") == "1"
                sched_time = db.get_setting("schedule_time", "09:00").strip()
                auto_retry = db.get_setting("auto_retry_outside_hours", "1") == "1"
                retry_interval = int(db.get_setting("retry_interval_minutes", "30"))

                now = datetime.now()
                now_time_str = now.strftime("%H:%M")
                today_str = now.strftime("%Y-%m-%d")

                # 1. Check for scheduled daily run
                if enabled and now_time_str == sched_time and self.last_scheduled_date != today_str:
                    logger.info(f"⏰ Auto-Scheduler: Triggering scheduled daily run at {now_time_str}...")
                    self.last_scheduled_date = today_str
                    self.retry_at = None
                    if self.run_all_callback:
                        threading.Thread(target=self._run_with_retry_watch, daemon=True).start()

                # 2. Check for pending auto-retry
                elif self.retry_at and now >= self.retry_at and auto_retry:
                    logger.info(f"⏰ Auto-Scheduler: Executing queued retry after 'Outside working hours'...")
                    self.retry_at = None
                    if self.run_all_callback:
                        threading.Thread(target=self._run_with_retry_watch, daemon=True).start()

            except Exception as e:
                logger.error(f"Scheduler loop error: {e}")

            time.sleep(30)

    def _run_with_retry_watch(self):
        if not self.run_all_callback:
            return
        results = self.run_all_callback()
        auto_retry = db.get_setting("auto_retry_outside_hours", "1") == "1"
        retry_interval = int(db.get_setting("retry_interval_minutes", "30"))

        # Check if accounts had "Outside working hours"
        accounts = db.get_accounts()
        outside_hours = any("working hours" in (a.get("last_status") or "").lower() for a in accounts)

        if outside_hours and auto_retry:
            self.retry_at = datetime.now() + timedelta(minutes=retry_interval)
            retry_str = self.retry_at.strftime("%H:%M:%S")
            logger.info(f"⏰ Outside working hours detected. Auto-retry scheduled at {retry_str} (in {retry_interval}m).")
        else:
            self.retry_at = None

    def get_status(self) -> Dict[str, Any]:
        enabled = db.get_setting("schedule_enabled", "1") == "1"
        sched_time = db.get_setting("schedule_time", "09:00").strip()
        retry_interval = int(db.get_setting("retry_interval_minutes", "30"))

        status_text = "Disabled"
        if enabled:
            if self.retry_at:
                status_text = f"Retrying at {self.retry_at.strftime('%H:%M')}"
            else:
                status_text = f"Active (Next: {sched_time})"

        return {
            "enabled": enabled,
            "schedule_time": sched_time,
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
