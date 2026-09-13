"""
Ace775 Automation Bot for Linux VPS & Local Environments
Supports:
  1. Playwright Headless Browser Mode (Full mobile Vue SPA emulation)
  2. Direct API Mode (Ultra-lightweight HTTP mode for low-memory VPS)

Features:
  - Phone + Password Login with Error Detection & Auto-Formatting
  - Daily Sign-in / Check-in
  - Automated Daily Task Execution (with countdown timer & rating submission)
  - Working hours & Sunday restriction detection
  - Configurable task limit (e.g. --max-tasks 3 for testing)
  - Daily Telegram Report Notification
"""

import os
import sys
import time
import random
import logging
import argparse
from typing import Optional, Dict, Any, List
from datetime import datetime
from dotenv import load_dotenv

# Configure clean logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("AceBot")

load_dotenv()


# ==============================================================================
# Telegram Notification Service
# ==============================================================================
class TelegramReporter:
    def __init__(self, bot_token: Optional[str] = None, chat_id: Optional[str] = None):
        self.bot_token = bot_token or os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        self.chat_id = chat_id or os.getenv("TELEGRAM_CHAT_ID", "").strip()

    @property
    def is_configured(self) -> bool:
        return bool(self.bot_token and self.chat_id)

    def send_message(self, text: str) -> bool:
        if not self.is_configured:
            return False

        import requests
        url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
        payload = {
            "chat_id": self.chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True
        }
        try:
            resp = requests.post(url, json=payload, timeout=10)
            if resp.status_code == 200:
                logger.info("[Telegram] Daily report sent successfully!")
                return True
            else:
                logger.warning(f"[Telegram] Failed to send message: {resp.status_code} - {resp.text}")
                return False
        except Exception as e:
            logger.error(f"[Telegram] Error sending message: {e}")
            return False

    def send_report(self, stats: Dict[str, Any]) -> bool:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        phone = stats.get("phone", "Unknown")
        mode = stats.get("mode", "browser").upper()
        grade = stats.get("grade", "N/A")
        balance = stats.get("balance", "N/A")
        currency = stats.get("currency", "GHS")
        checkin_status = stats.get("checkin_status", "Skipped")
        tasks = stats.get("tasks", [])
        total_earned = stats.get("total_earned", 0.0)

        lines = [
            "🚀 <b>Ace775 Daily Automation Report</b>",
            f"📅 <i>{now}</i>",
            "",
            f"👤 <b>Account:</b> <code>{phone}</code>",
            f"👑 <b>VIP Level:</b> {grade}",
            f"💰 <b>Wallet Balance:</b> {currency} {balance}",
            f"⚙️ <b>Execution Mode:</b> {mode}",
            "",
            f"🗓 <b>Daily Check-in:</b> {checkin_status}",
            f"📋 <b>Tasks Completed:</b> {len(tasks)}"
        ]

        if tasks:
            for t in tasks:
                title = t.get("title", "Task")
                amt = t.get("amount", "0")
                lines.append(f"  • {title} (+{amt} {currency})")
            lines.append(f"💵 <b>Total Earned:</b> +{total_earned:.2f} {currency}")

        if stats.get("error"):
            lines.extend(["", f"ℹ️ <b>Status Note:</b> {stats['error']}"])

        lines.extend(["", "✅ <i>Finished.</i>"])
        return self.send_message("\n".join(lines))

    def send_error_alert(self, account_label: str, phone: str, error_msg: str) -> bool:
        if not self.is_configured:
            return False
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        label = account_label or phone
        lines = [
            "⚠️ <b>Ace775 Task Execution Failure Alert</b>",
            f"📅 <i>{now}</i>",
            "",
            f"👤 <b>Account:</b> {label} (<code>{phone}</code>)",
            f"❌ <b>Error:</b> <code>{error_msg}</code>",
            "",
            "ℹ️ <i>Please check your web dashboard or account credentials.</i>"
        ]
        return self.send_message("\n".join(lines))

    def send_withdrawal_alert(self, account_label: str, phone: str, amount: float, status: str, details: str = "") -> bool:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        lines = [
            "💸 <b>Ace775 Withdrawal Alert</b>",
            f"📅 <i>{now}</i>",
            "",
            f"👤 <b>Account:</b> {account_label} (<code>{phone}</code>)",
            f"💵 <b>Amount:</b> {amount:.2f} GHS",
            f"📊 <b>Status:</b> {status}"
        ]
        if details:
            lines.append(f"ℹ️ <b>Details:</b> {details}")
        return self.send_message("\n".join(lines))


# ==============================================================================
# Direct API Mode (Lightweight & Fast for Linux VPS / Local Testing)
# ==============================================================================
class AceApiBot:
    def __init__(self, base_url: str, phone: str, password: str):
        import requests
        self.base_url = base_url.rstrip("/")
        self.phone = phone
        self.password = password
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 "
                "Mobile/15E148 Safari/604.1"
            ),
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json;charset=UTF-8",
            "Referer": f"{self.base_url}/",
            "Origin": self.base_url,
        })
        self.token: Optional[str] = None
        self.user_info: Dict[str, Any] = {}
        self.stats: Dict[str, Any] = {
            "phone": phone,
            "mode": "api",
            "checkin_status": "Skipped",
            "tasks": [],
            "total_earned": 0.0,
            "currency": "GHS"
        }

    def _post(self, path: str, json_data: Optional[dict] = None) -> dict:
        url = f"{self.base_url}{path}"
        for attempt in range(1, 4):
            try:
                resp = self.session.post(url, json=json_data or {}, timeout=15)
                resp.raise_for_status()
                return resp.json()
            except Exception as e:
                if attempt < 3:
                    time.sleep(1.5 * attempt)
                else:
                    logger.error(f"POST {path} failed after 3 attempts: {e}")
                    return {}
        return {}

    def _get(self, path: str, params: Optional[dict] = None) -> dict:
        url = f"{self.base_url}{path}"
        for attempt in range(1, 4):
            try:
                resp = self.session.get(url, params=params or {}, timeout=15)
                resp.raise_for_status()
                return resp.json()
            except Exception as e:
                if attempt < 3:
                    time.sleep(1.5 * attempt)
                else:
                    logger.error(f"GET {path} failed after 3 attempts: {e}")
                    return {}
        return {}

    def login(self) -> bool:
        logger.info(f"[API] Attempting login for phone: {self.phone}...")
        payload = {
            "username": self.phone,
            "password": self.password,
            "log_type": 1,
            "login_idx": "H5_automation_bot"
        }
        res = self._post("/api/Login/login", payload)
        
        token = None
        if isinstance(res, dict):
            if res.get("code") == 1 and isinstance(res.get("data"), dict):
                token = res["data"].get("token")
            elif "token" in res:
                token = res.get("token")
            elif res.get("code") == 1 and isinstance(res.get("data"), str):
                token = res.get("data")

        if token:
            self.token = token
            self.session.headers["token"] = token
            self.session.headers["Authorization"] = f"Bearer {token}"
            logger.info("[API] Login successful! Token acquired.")
            self.fetch_user_info()
            return True
        else:
            msg = res.get("msg", "Unknown error or invalid credentials")
            logger.error(f"[API] Login failed: {msg}")
            self.stats["error"] = f"Login failed: {msg}"
            return False

    def fetch_user_info(self):
        res = self._get("/api/User/info")
        if isinstance(res, dict) and res.get("code") == 1:
            data = res.get("data", {})
            self.user_info = data
            username = data.get("username", self.phone)
            balance = data.get("money", "0")
            grade = data.get("grade_name", data.get("grade", "N/A"))
            self.stats["balance"] = balance
            self.stats["grade"] = grade
            logger.info(f"[API] User: {username} | VIP Level: {grade} | Balance: {balance}")

    def do_checkin(self) -> bool:
        logger.info("[API] Checking daily sign-in status...")
        month_res = self._get("/api/checkin/checkinMonthList", {"activity_id": 0})
        activity_id = 0
        if isinstance(month_res, dict) and month_res.get("code") == 1:
            data = month_res.get("data", {})
            for date_key, item in data.items() if isinstance(data, dict) else []:
                if isinstance(item, dict) and item.get("is_today") == 1:
                    if item.get("is_checkin") == 1:
                        logger.info("[API] Already checked in today! Skipping.")
                        self.stats["checkin_status"] = "✅ Already signed in today"
                        return True

        # Check-in with auto-retry on transient errors (#8)
        max_retries = 3
        for attempt in range(1, max_retries + 1):
            res = self._post("/api/Checkin/checkin", {"activity_id": activity_id})
            if isinstance(res, dict) and res.get("code") == 1:
                logger.info(f"[API] Daily check-in successful! Message: {res.get('msg', 'Success')}")
                self.stats["checkin_status"] = "✅ Successfully signed in"
                return True
            msg = res.get("msg", "") if isinstance(res, dict) else ""
            if "already" in msg.lower() or "已签到" in msg:
                self.stats["checkin_status"] = "✅ Already signed in today"
                return True
            if attempt < max_retries:
                wait = 2 ** attempt
                logger.info(f"[API] Check-in attempt {attempt} failed ({msg}). Retrying in {wait}s...")
                time.sleep(wait)
            else:
                logger.info(f"[API] Check-in result: {msg or 'Failed'}")
                self.stats["checkin_status"] = f"ℹ️ {msg or 'Failed'}"
                return False
        return False

    def do_tasks(self, max_tasks: Optional[int] = None) -> bool:
        logger.info("[API] Fetching daily task list...")
        res = self._get("/api/Task/index", {"page_no": 0, "type": 7, "status_flag": 0})
        if not isinstance(res, dict):
            logger.error("[API] Failed to fetch task list.")
            return False

        data = res.get("data", res)
        task_list = data.get("list", []) if isinstance(data, dict) else []
        ongoing_total = data.get("ongoing_total", len(task_list)) if isinstance(data, dict) else len(task_list)

        logger.info(f"[API] Total tasks found: {len(task_list)} (Ongoing: {ongoing_total})")

        incomplete_tasks = [t for t in task_list if not t.get("is_complate")]
        if not incomplete_tasks:
            logger.info("[API] All daily tasks are already completed! Great job.")
            return True

        if max_tasks and max_tasks > 0:
            logger.info(f"[API] Limit set to {max_tasks} task(s) for this run.")
            incomplete_tasks = incomplete_tasks[:max_tasks]

        logger.info(f"[API] Tasks to execute in this run: {len(incomplete_tasks)}")
        for idx, task in enumerate(incomplete_tasks, 1):
            task_id = task.get("id")
            title = task.get("title", f"Task #{task_id}")
            amount = task.get("amount", "0")
            logger.info(f"\n--- [API] Processing Task {idx}/{len(incomplete_tasks)}: '{title}' (+{amount}) ---")

            detail_res = self._get("/api/Task/details", {"id": task_id})
            limits = 5
            if isinstance(detail_res, dict):
                detail_data = detail_res.get("data", detail_res)
                if isinstance(detail_data, dict):
                    limits = int(detail_data.get("limits", 5))

            limits = max(limits, 5)
            logger.info(f"[API] Waiting for task countdown timer: {limits}s (with human jitter)...")
            for remaining in range(limits, 0, -1):
                sys.stdout.write(f"\r  Countdown: {remaining}s remaining... ")
                sys.stdout.flush()
                time.sleep(random.uniform(0.96, 1.06))
            print()

            comp_res = self._post("/api/Task/completeTask", {"task_id": task_id})
            if isinstance(comp_res, dict) and comp_res.get("code") == 1:
                logger.info(f"[API] Task '{title}' completed successfully! Reward added.")
                self.stats["tasks"].append({"title": title, "amount": str(amount)})
                try:
                    self.stats["total_earned"] += float(amount)
                except ValueError:
                    pass
            else:
                msg = comp_res.get("msg", "Unknown response")
                logger.warning(f"[API] Task completion response: {msg}")
                if "working hours" in msg.lower() or "forbid" in msg.lower() or "sunday" in msg.lower():
                    logger.warning(f"[API] Halting task execution: Server indicates '{msg}'")
                    self.stats["error"] = f"Tasks suspended by platform: {msg}"
                    break

            # Natural human delay before moving to next task (3.5s - 6.5s)
            cooldown = random.uniform(3.5, 6.5)
            logger.info(f"[API] Human delay: pausing {cooldown:.1f}s before next task...")
            time.sleep(cooldown)

        logger.info(f"[API] Finished processing tasks.")
        self.fetch_user_info()
        return True

    def apply_withdrawal(self, amount: float, pay_password: str, withdrawl_flag: int = 2, bypass_time_window: bool = False) -> Dict[str, Any]:
        """
        Submits a withdrawal request to https://ace775.com/api/Withdrawal/apply.
        Enforces 9am - 5pm time window and checks for required parameters.
        """
        now = datetime.now()
        if not bypass_time_window:
            if now.hour < 9 or now.hour >= 17:
                err = f"Withdrawal rejected: Outside operating hours (09:00 - 17:00). Current: {now.strftime('%H:%M')}"
                logger.warning(f"[API] {err}")
                return {"success": False, "message": err}

        if not pay_password:
            err = "Withdrawal rejected: Transaction payment password is not configured."
            logger.warning(f"[API] {err}")
            return {"success": False, "message": err}

        if amount <= 0:
            err = "Withdrawal rejected: Withdrawal amount must be greater than 0."
            logger.warning(f"[API] {err}")
            return {"success": False, "message": err}

        if not self.token:
            if not self.login():
                err = "Withdrawal failed: Could not log in to Ace775."
                logger.error(f"[API] {err}")
                return {"success": False, "message": err}

        payload = {
            "amount": amount,
            "pay_password": pay_password,
            "withdrawl_flag": withdrawl_flag
        }
        logger.info(f"[API] Submitting withdrawal of {amount} GHS (Wallet Flag: {withdrawl_flag})...")
        res = self._post("/api/Withdrawal/apply", payload)
        if isinstance(res, dict) and res.get("code") == 1:
            msg = res.get("msg", "Withdrawal applied successfully")
            logger.info(f"[API] ✅ {msg}")
            self.fetch_user_info()
            return {"success": True, "message": msg, "data": res.get("data")}
        else:
            msg = res.get("msg", "Withdrawal application failed") if isinstance(res, dict) else "Unknown API response"
            logger.error(f"[API] ❌ Withdrawal failed: {msg}")
            return {"success": False, "message": msg}

    def run(self, do_checkin: bool = True, do_tasks: bool = True, max_tasks: Optional[int] = None) -> Dict[str, Any]:
        if not self.login():
            return self.stats
        if do_checkin:
            self.do_checkin()
        if do_tasks:
            self.do_tasks(max_tasks=max_tasks)
        logger.info("[API] Automation workflow finished successfully!")
        return self.stats


# ==============================================================================
# Playwright Headless Browser Mode (Full Mobile Vue SPA Emulation)
# ==============================================================================
class AcePlaywrightBot:
    def __init__(self, base_url: str, phone: str, password: str, headless: bool = True):
        self.base_url = base_url.rstrip("/")
        self.phone = phone
        self.password = password
        self.headless = headless
        self.stats: Dict[str, Any] = {
            "phone": phone,
            "mode": "browser",
            "checkin_status": "Skipped",
            "tasks": [],
            "total_earned": 0.0,
            "currency": "GHS"
        }

    def _navigate_spa(self, page, hash_path: str):
        page.evaluate(f"() => {{ window.location.hash = '{hash_path}'; }}")
        page.wait_for_timeout(2000)
        self._dismiss_popups(page)

    def run(self, do_checkin: bool = True, do_tasks: bool = True, max_tasks: Optional[int] = None) -> Dict[str, Any]:
        from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

        logger.info(f"[Browser] Starting Playwright (Headless={self.headless})...")
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=self.headless,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-blink-features=AutomationControlled",
                ]
            )

            context = browser.new_context(
                viewport={"width": 375, "height": 812},
                user_agent=(
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 "
                    "Mobile/15E148 Safari/604.1"
                ),
                is_mobile=True,
                has_touch=True
            )
            page = context.new_page()
            page.on("dialog", lambda dialog: (logger.info(f"[Browser] Dialog: '{dialog.message}'"), dialog.accept()))

            try:
                # 1. Login
                logger.info(f"[Browser] Navigating to {self.base_url}/#/log...")
                page.goto(f"{self.base_url}/#/log", wait_until="networkidle", timeout=30000)
                page.wait_for_timeout(2000)
                self._dismiss_popups(page)

                logger.info(f"[Browser] Filling credentials for {self.phone}...")
                phone_input = page.locator("input[placeholder*='Phone'], input[placeholder*='手机号'], input[type='tel'], input[type='text']").first
                phone_input.wait_for(state="visible", timeout=10000)
                phone_input.fill(self.phone)

                pwd_input = page.locator("input[type='password']").first
                pwd_input.wait_for(state="visible", timeout=10000)
                pwd_input.fill(self.password)

                login_btn = page.locator("button:has-text('Login'), button:has-text('登录'), .btnLogin, .van-button--info").first
                logger.info("[Browser] Clicking Login button...")
                login_btn.click()

                page.wait_for_timeout(3000)

                dialog_msg = page.locator(".van-dialog__message").first
                if dialog_msg.is_visible():
                    err_txt = dialog_msg.inner_text().strip()
                    logger.error(f"[Browser] Login alert: '{err_txt}'")
                    self.stats["error"] = f"Login Error: {err_txt}"
                    self._dismiss_popups(page)
                    return self.stats

                token = page.evaluate("() => localStorage.getItem('token')")
                if not token or page.url.endswith("/log"):
                    logger.error(f"[Browser] Login not successful (URL: {page.url}). Stopping.")
                    self.stats["error"] = "Login failed: credentials rejected or session not created."
                    return self.stats

                logger.info("[Browser] Login successful! Token acquired.")
                self._dismiss_popups(page)

                # 2. Daily Sign-In / Check-in
                if do_checkin:
                    logger.info(f"[Browser] Navigating to Check-in page ({self.base_url}/#/checkin)...")
                    self._navigate_spa(page, "#/checkin")

                    checkin_btn = page.locator("button:has-text('Check In Now'), button:has-text('立即签到'), .btnWarp button").first
                    if checkin_btn.is_visible():
                        btn_text = checkin_btn.inner_text().strip()
                        if "SIGNED IN" in btn_text.upper() or "已签到" in btn_text:
                            logger.info("[Browser] Daily sign-in already completed today.")
                            self.stats["checkin_status"] = "✅ Already signed in today"
                        else:
                            logger.info(f"[Browser] Clicking check-in button ('{btn_text}')...")
                            checkin_btn.click()
                            page.wait_for_timeout(2000)
                            logger.info("[Browser] Daily check-in clicked successfully.")
                            self.stats["checkin_status"] = "✅ Successfully signed in"
                    else:
                        logger.info("[Browser] Check-in button not active or already checked in.")
                        self.stats["checkin_status"] = "ℹ️ Already checked in / not available"

                # 3. Daily Tasks
                if do_tasks:
                    logger.info(f"[Browser] Navigating to Tasks page ({self.base_url}/#/task)...")
                    self._navigate_spa(page, "#/task")

                    task_items = page.locator(".grid2 ul li, .taskList li, .contWarp ul li")
                    count = task_items.count()
                    logger.info(f"[Browser] Found {count} task card elements.")

                    if count == 0:
                        logger.info("[Browser] No task items found or all tasks completed.")
                    else:
                        target_tasks = max_tasks if (max_tasks and max_tasks > 0) else count
                        completed_in_run = 0

                        for i in range(count):
                            if completed_in_run >= target_tasks:
                                logger.info(f"[Browser] Reached requested limit of {target_tasks} task(s). Stopping.")
                                break

                            self._navigate_spa(page, "#/task")
                            current_items = page.locator(".grid2 ul li, .taskList li, .contWarp ul li")
                            if i >= current_items.count():
                                break
                            item = current_items.nth(i)

                            text = item.inner_text()
                            if "Completed" in text or "已完成" in text:
                                logger.info(f"[Browser] Task {i+1} is already completed. Skipping.")
                                continue

                            title = f"Task #{i+1}"
                            amount = "0"
                            try:
                                h4 = item.locator("h4").first
                                if h4.is_visible():
                                    title = h4.inner_text().strip()
                                p = item.locator(".textWarp p, p").first
                                if p.is_visible():
                                    amount = p.inner_text().replace("+", "").strip()
                            except Exception:
                                pass

                            logger.info(f"\n--- [Browser] Starting Task {i+1} ('{title}') [Run task {completed_in_run+1}/{target_tasks}] ---")
                            
                            # Click the submit button inside the task card
                            card_btn = item.locator("button, .btnWarp button").first
                            if card_btn.is_visible():
                                card_btn.click()
                            else:
                                item.click()
                            page.wait_for_timeout(2000)

                            # Check for platform modal alert (e.g. "Outside working hours", "No tasks on Sundays")
                            dialog_msg = page.locator(".van-dialog__message").first
                            if dialog_msg.is_visible():
                                alert_text = dialog_msg.inner_text().strip()
                                logger.warning(f"[Browser] Platform Notice: '{alert_text}'")
                                self.stats["error"] = f"Tasks suspended by platform: {alert_text}"
                                self._dismiss_popups(page)
                                break

                            logger.info(f"[Browser] Currently on: {page.url}")
                            countdown_elem = page.locator(".btnWarp button, .detailsWarp .btnWarp").first

                            max_wait = 30
                            while max_wait > 0 and page.url.endswith("tDetails"):
                                btn_txt = countdown_elem.inner_text().strip() if countdown_elem.is_visible() else ""
                                if "Completed" in btn_txt or "已完成" in btn_txt:
                                    logger.info("[Browser] Task completed!")
                                    completed_in_run += 1
                                    self.stats["tasks"].append({"title": title, "amount": amount})
                                    try:
                                        self.stats["total_earned"] += float(amount)
                                    except ValueError:
                                        pass
                                    break
                                time.sleep(1)
                                max_wait -= 1

                            rate_popup = page.locator(".rateWarp, .van-popup:has(.van-rate)")
                            if rate_popup.is_visible():
                                logger.info("[Browser] 5-Star rating popup appeared. Rating 5 stars...")
                                stars = page.locator(".van-rate__item")
                                if stars.count() >= 5:
                                    stars.nth(4).click()
                                    page.wait_for_timeout(500)
                                confirm_btn = page.locator(".rateWarp button:has-text('Confirm'), .rateWarp button:has-text('确认')").first
                                if confirm_btn.is_visible():
                                    confirm_btn.click()
                                    page.wait_for_timeout(1000)

                            page.wait_for_timeout(2000)

                    logger.info("[Browser] Finished processing daily tasks.")

                # Retrieve balance and grade from /#/user
                try:
                    self._navigate_spa(page, "#/user")
                    balance_el = page.locator(".money, .accountBalance, .userMoney, .van-nav-bar__title").first
                    if balance_el.is_visible():
                        self.stats["balance"] = balance_el.inner_text().strip()
                except Exception:
                    pass

            except PlaywrightTimeoutError as te:
                logger.error(f"[Browser] Timeout occurred: {te}")
                self.stats["error"] = f"Browser Timeout: {te}"
            except Exception as e:
                logger.error(f"[Browser] Unexpected error: {e}", exc_info=True)
                self.stats["error"] = f"Unexpected Error: {e}"
            finally:
                context.close()
                browser.close()
                logger.info("[Browser] Browser session closed.")
        return self.stats

    def _dismiss_popups(self, page):
        selectors = [
            ".popupWarp .close",
            ".van-popup__close-icon",
            ".van-dialog__confirm",
            ".taxCont",
            "button:has-text('Confirm')",
            "button:has-text('确认')",
            "button:has-text('Close')"
        ]
        for sel in selectors:
            try:
                el = page.locator(sel).first
                if el.is_visible(timeout=300):
                    el.click()
                    page.wait_for_timeout(300)
            except Exception:
                pass

        # If any lingering modal overlay intercepts pointer events, remove it
        try:
            page.evaluate("""() => {
                document.querySelectorAll('.van-overlay').forEach(el => {
                    if (el.offsetParent !== null) {
                        el.style.display = 'none';
                    }
                });
            }""")
        except Exception:
            pass


# ==============================================================================
# CLI Entrypoint
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(description="Ace775 Automation Bot for Linux VPS & Local Environments")
    parser.add_argument("--phone", default=os.getenv("ACE_PHONE", ""), help="Phone number / Username for ace775.com")
    parser.add_argument("--password", default=os.getenv("ACE_PASSWORD", ""), help="Password for ace775.com")
    parser.add_argument("--mode", default=os.getenv("ACE_MODE", "browser").lower(), choices=["browser", "api"],
                        help="Execution mode: 'browser' (Playwright Headless) or 'api' (Direct HTTP requests)")
    parser.add_argument("--base-url", default=os.getenv("ACE_BASE_URL", "https://ace775.com"), help="Base website URL")
    parser.add_argument("--headless", action="store_true", default=os.getenv("ACE_HEADLESS", "true").lower() == "true",
                        help="Run browser in headless mode")
    parser.add_argument("--no-checkin", action="store_true", help="Skip daily sign-in / check-in")
    parser.add_argument("--no-tasks", action="store_true", help="Skip daily task execution")
    parser.add_argument("--max-tasks", type=int, default=int(os.getenv("MAX_TASKS", 0)),
                        help="Limit number of tasks to execute (0 for all tasks, e.g. 3 for testing)")
    parser.add_argument("--telegram-token", default=os.getenv("TELEGRAM_BOT_TOKEN", ""), help="Telegram Bot Token")
    parser.add_argument("--telegram-chat-id", default=os.getenv("TELEGRAM_CHAT_ID", ""), help="Telegram Chat ID")

    args = parser.parse_args()

    phone = args.phone.strip()
    if phone.startswith("+233"):
        phone = phone[4:]
    elif phone.startswith("233"):
        phone = phone[3:]
    elif phone.startswith("0") and len(phone) == 10:
        phone = phone[1:]

    if not phone or not args.password:
        import db
        accounts = db.get_accounts()
        enabled_accounts = [a for a in accounts if a.get("enabled")]
        if enabled_accounts:
            logger.info(f"No standalone CLI credentials provided. Running {len(enabled_accounts)} active account(s) from database...")
            for idx, acc in enumerate(enabled_accounts, 1):
                logger.info(f"\n========================================")
                logger.info(f"Processing Account {idx}/{len(enabled_accounts)}: {acc['phone']} ({acc.get('label', '')})")
                logger.info(f"========================================")
                mode = acc.get("mode", "api")
                acc_tasks = acc.get("max_tasks") or max_tasks
                if mode == "browser":
                    b = AcePlaywrightBot(base_url=args.base_url, phone=acc["phone"], password=acc["password"], headless=args.headless)
                else:
                    b = AceApiBot(base_url=args.base_url, phone=acc["phone"], password=acc["password"])
                
                stats = b.run(do_checkin=do_checkin, do_tasks=do_tasks, max_tasks=acc_tasks)
                tg_token = args.telegram_token or db.get_setting("telegram_token", "")
                tg_chat = args.telegram_chat_id or db.get_setting("telegram_chat_id", "")
                reporter = TelegramReporter(bot_token=tg_token, chat_id=tg_chat)
                if reporter.is_configured:
                    reporter.send_report(stats)

                if idx < len(enabled_accounts):
                    pacing = random.uniform(15.0, 25.0)
                    logger.info(f"⏳ Cooldown pacing: waiting {pacing:.1f}s before next account...")
                    time.sleep(pacing)
            return
        else:
            logger.error("No accounts found! Please add accounts in the Web Dashboard (http://localhost:8000) or pass --phone and --password.")
            sys.exit(1)

    do_checkin = not args.no_checkin and os.getenv("DO_CHECKIN", "true").lower() == "true"
    do_tasks = not args.no_tasks and os.getenv("DO_TASKS", "true").lower() == "true"
    max_tasks = args.max_tasks if args.max_tasks > 0 else None

    logger.info("========================================")
    logger.info("           Ace775 Automation Bot        ")
    logger.info("========================================")
    logger.info(f"Target    : {args.base_url}")
    logger.info(f"Phone     : {phone}")
    logger.info(f"Mode      : {args.mode.upper()}")
    logger.info(f"Max Tasks : {max_tasks if max_tasks else 'All'}")
    logger.info(f"Check-in  : {do_checkin} | Tasks: {do_tasks}")
    logger.info("========================================")

    stats: Dict[str, Any] = {}
    if args.mode == "api":
        bot = AceApiBot(base_url=args.base_url, phone=phone, password=args.password)
        stats = bot.run(do_checkin=do_checkin, do_tasks=do_tasks, max_tasks=max_tasks)
    else:
        bot = AcePlaywrightBot(base_url=args.base_url, phone=phone, password=args.password, headless=args.headless)
        stats = bot.run(do_checkin=do_checkin, do_tasks=do_tasks, max_tasks=max_tasks)

    # Send Telegram notification if configured
    try:
        import db
        db_tg_token = db.get_setting("telegram_token", "")
        db_tg_chat = db.get_setting("telegram_chat_id", "")
    except Exception:
        db_tg_token, db_tg_chat = "", ""

    reporter = TelegramReporter(bot_token=args.telegram_token or db_tg_token, chat_id=args.telegram_chat_id or db_tg_chat)
    if reporter.is_configured:
        reporter.send_report(stats)


if __name__ == "__main__":
    main()
