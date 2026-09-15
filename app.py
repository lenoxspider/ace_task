"""
FastAPI Multi-Account Web Dashboard for Ace775 Bot
Provides REST APIs, SSE real-time log streaming, Smart Scheduler, Telegram Listener, and Analytics.
"""

import os
import sys
import time
import random
import asyncio
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
import secrets
import threading
import subprocess
import shlex
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn

import db
from ace_bot import AceApiBot, AcePlaywrightBot, TelegramReporter
from scheduler import scheduler, plan_task_slots
from telegram_listener import telegram_bot

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("AceApp")

app = FastAPI(title="Ace775 Web Dashboard", version="1.2.0")

import io
import csv

# Mount static folder
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def add_no_cache_header(request: Request, call_next):
    response = await call_next(request)
    # The dashboard is updated in place (see Settings > System & Updates), so never let a
    # browser hold on to the HTML shells either - only the API responses are left alone.
    if request.url.path.startswith("/static/") or not request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# Dashboard Master Session Authentication (#14: 2-Hour Inactivity Timeout)
ACTIVE_SESSIONS: set = set()
SESSION_LAST_ACTIVE: Dict[str, float] = {}
SESSION_TIMEOUT_SECONDS = 7200  # 2 hours
COOKIE_NAME = "ace_session"


def is_authenticated(request: Request) -> bool:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
        elif request.headers.get("X-Session-Token"):
            token = request.headers.get("X-Session-Token", "").strip()

    if token and token in ACTIVE_SESSIONS:
        now = time.time()
        last_active = SESSION_LAST_ACTIVE.get(token, now)
        if now - last_active > SESSION_TIMEOUT_SECONDS:
            ACTIVE_SESSIONS.discard(token)
            SESSION_LAST_ACTIVE.pop(token, None)
            return False
        SESSION_LAST_ACTIVE[token] = now
        return True
    return False


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    # Allow static assets and public auth endpoints
    if path.startswith(("/static", "/css", "/js")) or path in ["/login", "/api/auth/login", "/api/auth/check", "/favicon.ico"]:
        return await call_next(request)

    if not is_authenticated(request):
        if path == "/" or not path.startswith("/api"):
            return RedirectResponse(url="/login", status_code=302)
        return JSONResponse(status_code=401, content={"detail": "Unauthorized. Please log in."})

    return await call_next(request)


# In-memory log buffer and SSE subscriber queues
MAX_LOG_HISTORY = 300
log_history: List[Dict[str, Any]] = []
log_subscribers: List[asyncio.Queue] = []
RUNNING_ACCOUNT_IDS: set = set()
MAIN_LOOP: Optional[asyncio.AbstractEventLoop] = None

# Concurrency guards. Batch runs are serialized, and a single account can never be
# running in two places at once - the dashboard button, the scheduler and the Telegram
# listener all funnel into these same functions, on different threads.
_batch_lock = threading.Lock()
_account_locks: Dict[int, threading.Lock] = {}
_account_locks_guard = threading.Lock()


def _account_lock(account_id: int) -> threading.Lock:
    with _account_locks_guard:
        return _account_locks.setdefault(account_id, threading.Lock())


def _batch_running() -> bool:
    return _batch_lock.locked()


def broadcast_log(message: str, level: str = "info"):
    """Broadcast a log entry to in-memory history and active SSE streams."""
    timestamp = db.utc_now().strftime("%H:%M:%S")
    entry = {"timestamp": timestamp, "message": message, "level": level}
    log_history.append(entry)
    if len(log_history) > MAX_LOG_HISTORY:
        log_history.pop(0)

    # Dispatch to SSE listeners. This is called from worker threads too, so hand the
    # entry to the event loop instead of touching asyncio.Queue from another thread.
    dead_queues = []
    for q in log_subscribers:
        try:
            if MAIN_LOOP is not None and MAIN_LOOP.is_running():
                MAIN_LOOP.call_soon_threadsafe(q.put_nowait, entry)
            else:
                q.put_nowait(entry)
        except Exception:
            dead_queues.append(q)
    for dq in dead_queues:
        if dq in log_subscribers:
            log_subscribers.remove(dq)


# ==============================================================================
# Execution Workers with Anti-Ban Pacing
# ==============================================================================
def run_single_account(account_id: int, force: bool = False):
    """Public entry point: guarantees one account is never run concurrently twice."""
    lock = _account_lock(account_id)
    if not lock.acquire(blocking=False):
        broadcast_log(f"Account ID {account_id} is already running - duplicate trigger ignored.", "warning")
        return
    try:
        _run_single_account_inner(account_id, force)
    finally:
        lock.release()


def _run_single_account_inner(account_id: int, force: bool = False):
    account = db.get_account(account_id)
    if not account:
        broadcast_log(f"Account ID {account_id} not found!", "error")
        return

    phone = account["phone"]
    pwd = account["password"]
    label = account.get("label") or phone
    mode = account.get("mode", "api")
    max_tasks = account.get("max_tasks", 0)
    base_url = db.get_setting("base_url", "https://ace775.com")

    # Paused Guard: Check if operator has paused this account from completing tasks
    if account.get("enabled", 1) == 0:
        broadcast_log(f"⏸️ Account '{label}' (+233 {phone}) is PAUSED. Automation skipped.", "warning")
        db.update_account_stats(account_id, last_status="Paused")
        return

    # Daily Completion Guard: If not explicitly forced, skip accounts that already completed tasks today
    today_str = db.utc_now().strftime("%Y-%m-%d")
    last_run = account.get("last_run_time") or ""
    status = (account.get("last_status") or "").lower()
    tasks_today = int(account.get("tasks_done_today") or 0)
    target_tasks = int(account.get("max_tasks") or 0)
    
    if target_tasks > 0:
        is_done = ("completed" in status or tasks_today >= target_tasks)
    else:
        is_done = ("completed" in status)
    
    if not force and last_run.startswith(today_str) and is_done:
        broadcast_log(f"⏭️ Skipping '{label}' (+233 {phone}): All daily tasks are already completed today ({tasks_today} tasks done).", "info")
        return

    RUNNING_ACCOUNT_IDS.add(account_id)
    broadcast_log(f"[ACCOUNT_RUNNING:{account_id}]", "event")

    # Sunday Guard: Ace775 platform is closed for tasks on Sundays
    if db.utc_now().weekday() == 6:
        broadcast_log(f"⏸️ [Sunday Rest Day] '{label}': Ace775 platform is closed on Sundays. Tasks & check-ins are suspended today.", "warning")
        db.update_account_stats(account_id, last_status="Sunday: Rest Day")
        RUNNING_ACCOUNT_IDS.discard(account_id)
        broadcast_log(f"[ACCOUNT_IDLE:{account_id}]", "event")
        return

    broadcast_log(f"🚀 Starting run for '{label}' ({phone}) in {mode.upper()} mode...", "info")
    db.update_account_stats(account_id, last_status="Running...")

    # Telegram reporter setup
    tg_token = db.get_setting("telegram_token", os.getenv("TELEGRAM_BOT_TOKEN", ""))
    tg_chat = db.get_setting("telegram_chat_id", os.getenv("TELEGRAM_CHAT_ID", ""))
    reporter = TelegramReporter(bot_token=tg_token, chat_id=tg_chat)

    stats: Dict[str, Any] = {}
    try:
        if mode == "browser":
            bot = AcePlaywrightBot(base_url=base_url, phone=phone, password=pwd, headless=True)
            stats = bot.run(do_checkin=True, do_tasks=True, max_tasks=max_tasks if max_tasks > 0 else None)
        else:
            bot = AceApiBot(base_url=base_url, phone=phone, password=pwd)
            stats = bot.run(do_checkin=True, do_tasks=True, max_tasks=max_tasks if max_tasks > 0 else None)

        balance = stats.get("balance", "0")
        grade = stats.get("grade", "N/A")
        tasks = stats.get("tasks", [])
        total_earned = stats.get("total_earned", 0.0)
        status_msg = "Completed"
        if stats.get("error"):
            status_msg = stats["error"]
            if reporter.is_configured:
                err_lower = status_msg.lower()
                is_auth_error = any(w in err_lower for w in [
                    "login failed", "invalid credentials", "password", "user does not exist",
                    "account disabled", "frozen", "token rejected", "credentials rejected",
                    "forbidden", "auth"
                ])
                if is_auth_error:
                    reporter.send_account_health_alert(label, phone, "Authentication / Credential Failure", status_msg)
                else:
                    reporter.send_error_alert(label, phone, status_msg)

        try:
            inc_bal = float(stats.get("income_balance") or 0.0)
        except (ValueError, TypeError):
            inc_bal = 0.0

        try:
            pers_bal = float(stats.get("personal_balance") or 0.0)
        except (ValueError, TypeError):
            pers_bal = 0.0

        db.update_account_stats(
            account_id,
            vip_level=grade,
            balance=balance,
            income_balance=inc_bal,
            personal_balance=pers_bal,
            withdrawal_amounts=stats.get("withdrawal_amounts"),
            withdrawal_fee=stats.get("withdrawal_fee"),
            last_status=status_msg,
            tasks_done=len(tasks),
            earned=total_earned,
            lifetime_tasks=stats.get("lifetime_tasks"),
            lifetime_earned=stats.get("lifetime_earned"),
            tasks_done_today=stats.get("tasks_done_today"),
            earned_today=stats.get("today_earned")
        )

        broadcast_log(
            f"✅ Finished '{label}': VIP {grade}, Balance {balance} GHS (Income: {inc_bal:.2f} GHS), Tasks {len(tasks)}, Earned +{total_earned:.2f} GHS ({status_msg})",
            "success" if not stats.get("error") else "warning"
        )

        # Telegram report
        if reporter.is_configured and not stats.get("error"):
            reporter.send_report(stats)

        # Automated Withdrawal Pipeline (Checked after tasks and balance update)
        updated_account = db.get_account(account_id, decrypt=True)
        if updated_account and updated_account.get("auto_withdraw") == 1:
            w_amount = float(updated_account.get("withdraw_amount") or 0.0)
            pay_pwd = updated_account.get("pay_password") or ""
            w_flag = int(updated_account.get("withdraw_wallet") or 2)

            # Target wallet balance check (Income Wallet = 2 is standard)
            if w_flag == 2:
                try:
                    available_bal = float(updated_account.get("income_balance") or 0.0)
                except (ValueError, TypeError):
                    available_bal = 0.0
                if available_bal <= 0:
                    try:
                        available_bal = float(updated_account.get("balance") or 0.0)
                    except (ValueError, TypeError):
                        available_bal = 0.0
                wallet_name = "Income Wallet"
            else:
                try:
                    available_bal = float(updated_account.get("personal_balance") or 0.0)
                except (ValueError, TypeError):
                    available_bal = 0.0
                if available_bal <= 0:
                    try:
                        available_bal = float(updated_account.get("balance") or 0.0)
                    except (ValueError, TypeError):
                        available_bal = 0.0
                wallet_name = "Personal Wallet"

            raw_denominations = updated_account.get("withdrawal_amounts") or [65, 170, 525, 1600, 4500, 14000, 33500, 65000, 150000, 200000, 500000, 1000000]
            allowed_denominations = sorted([float(x) for x in raw_denominations])
            min_platform_amount = allowed_denominations[0] if allowed_denominations else 65.0

            # Determine target withdrawal amount
            if w_amount > 0:
                target_withdraw = w_amount
            else:
                target_withdraw = min_platform_amount
                for tier in reversed(allowed_denominations):
                    if available_bal >= tier:
                        target_withdraw = float(tier)
                        break

            # 1. ALWAYS check account balance first
            if available_bal < target_withdraw:
                status_note = f"Holding: {wallet_name} {available_bal:.2f} < Target {target_withdraw:.2f} GHS"
                db.update_account_withdrawal_status(account_id, status=status_note, withdraw_date=updated_account.get("last_withdraw_date", ""))
                broadcast_log(
                    f"⏸️ [Auto-Withdraw] Balance Checked for '{label}': {wallet_name} ({available_bal:.2f} GHS) has not reached target ({target_withdraw:.2f} GHS). Holding until tasks accumulate.",
                    "info"
                )
            else:
                # 2. Balance target reached! Enqueue into intelligent anti-clustering withdrawal queue
                if not pay_pwd:
                    db.update_account_withdrawal_status(account_id, status="Missing Payment PIN", withdraw_date=updated_account.get("last_withdraw_date", ""))
                    broadcast_log(f"⚠️ [Auto-Withdraw] Balance reached target ({available_bal:.2f} GHS >= {target_withdraw:.2f} GHS) for '{label}', but skipped: Transaction PIN/password not configured in account settings.", "warning")
                else:
                    q_res = db.enqueue_withdrawal(
                        account_id=account_id,
                        phone=phone,
                        label=label,
                        amount=target_withdraw,
                        wallet_flag=w_flag,
                        pay_password=pay_pwd
                    )
                    if q_res.get("queued"):
                        sched_time = q_res.get("scheduled_for", "")
                        broadcast_log(
                            f"📥 [Auto-Withdraw] Queued {target_withdraw:.2f} GHS for '{label}'! "
                            f"Scheduled for {sched_time} (Randomized spacing strictly within 09:00-17:00 Mon-Fri).",
                            "success"
                        )
                        if reporter.is_configured:
                            reporter.send_withdrawal_alert(
                                label, phone, target_withdraw, "Queued (Anti-Clustering Spacing)",
                                f"Scheduled execution at {sched_time}."
                            )
                    elif q_res.get("already_queued"):
                        broadcast_log(
                            f"ℹ️ [Auto-Withdraw] '{label}' already has an active withdrawal in queue scheduled for {q_res.get('scheduled_for')}.",
                            "info"
                        )
                    else:
                        broadcast_log(
                            f"⏸️ [Auto-Withdraw] '{label}': {q_res.get('message', 'Cannot queue withdrawal.')}",
                            "info"
                        )

    except Exception as e:
        logger.error(f"Error running account {account_id}: {e}", exc_info=True)
        broadcast_log(f"❌ Error running '{label}': {e}", "error")
        db.update_account_stats(account_id, last_status=f"Error: {str(e)[:50]}")
        if reporter.is_configured:
            err_str = str(e)
            err_lower = err_str.lower()
            is_auth_error = any(w in err_lower for w in ["login", "password", "credential", "auth", "token", "frozen", "disabled"])
            if is_auth_error:
                reporter.send_account_health_alert(label, phone, "Authentication / Credential Error", err_str)
            else:
                reporter.send_error_alert(label, phone, err_str)
    finally:
        RUNNING_ACCOUNT_IDS.discard(account_id)
        broadcast_log(f"[ACCOUNT_IDLE:{account_id}]", "event")


def run_all_enabled_accounts():
    # Serialize batch runs - dashboard button, scheduler and Telegram all call this.
    if not _batch_lock.acquire(blocking=False):
        broadcast_log("⚠️ An execution job is already in progress!", "warning")
        return
    try:
        # Sunday Guard: Ace775 platform is closed for tasks on Sundays
        if db.utc_now().weekday() == 6:
            broadcast_log("⏸️ [Sunday Rest Day] Ace775 platform is closed on Sundays. Batch automation suspended today.", "warning")
            return
        accounts = db.get_accounts()
        enabled_accounts = [a for a in accounts if a["enabled"]]
        today_str = db.utc_now().strftime("%Y-%m-%d")

        # Skip accounts that have already completed all daily tasks today
        pending_accounts = []
        already_completed = []
        for a in enabled_accounts:
            last_run = a.get("last_run_time") or ""
            status = (a.get("last_status") or "").lower()
            tasks_today = int(a.get("tasks_done_today") or 0)
            target_tasks = int(a.get("max_tasks") or 0)
            
            if target_tasks > 0:
                is_done = ("completed" in status or tasks_today >= target_tasks)
            else:
                is_done = ("completed" in status)
            
            if last_run.startswith(today_str) and is_done:
                already_completed.append(a)
            else:
                pending_accounts.append(a)

        if already_completed:
            labels = ", ".join([f"'{a.get('label') or a['phone']}'" for a in already_completed])
            broadcast_log(f"ℹ️ {len(already_completed)} account(s) already completed today's tasks ({labels}) and will be skipped.", "info")

        if not pending_accounts:
            broadcast_log(f"🎉 All {len(enabled_accounts)} active account(s) have already completed their tasks for today! Nothing to run.", "success")
            return

        broadcast_log(f"📋 Starting batch execution for {len(pending_accounts)} remaining active account(s)...", "info")

        for idx, acc in enumerate(pending_accounts, 1):
            broadcast_log(f"\n--- Processing account {idx}/{len(pending_accounts)}: {acc['phone']} ---", "info")
            run_single_account(acc["id"], force=False)

            # Account pacing: randomized pause before next account (15s - 25s)
            if idx < len(pending_accounts):
                pacing = random.uniform(15.0, 25.0)
                broadcast_log(f"⏳ Account Pacing: waiting {pacing:.1f}s before next account...", "info")
                time.sleep(pacing)

        broadcast_log("🎉 Batch execution for active accounts finished!", "success")
    finally:
        _batch_lock.release()


# Connect callbacks to Scheduler and Telegram Listener
scheduler.run_all_callback = run_all_enabled_accounts
scheduler.run_single_callback = run_single_account
scheduler.broadcast_callback = broadcast_log
telegram_bot.run_all_callback = run_all_enabled_accounts


# ==============================================================================
# Lifecycle & Models
# ==============================================================================
@app.on_event("startup")
async def on_startup():
    global MAIN_LOOP
    MAIN_LOOP = asyncio.get_running_loop()
    scheduler.start()
    telegram_bot.start()
    broadcast_log("⚡ Ace775 Control Center initialized with Auto-Scheduler and Telegram Listener.", "success")


@app.on_event("shutdown")
def on_shutdown():
    scheduler.stop()
    telegram_bot.stop()


class AccountCreate(BaseModel):
    phone: str
    password: str
    label: Optional[str] = ""
    max_tasks: Optional[int] = 0
    mode: Optional[str] = "api"
    enabled: Optional[int] = 1
    auto_withdraw: Optional[int] = 0
    withdraw_amount: Optional[float] = 0.0
    pay_password: Optional[str] = ""
    withdraw_wallet: Optional[int] = 2
    window_start: Optional[str] = ""
    window_end: Optional[str] = ""


class AccountUpdate(BaseModel):
    phone: Optional[str] = None
    password: Optional[str] = None
    label: Optional[str] = None
    max_tasks: Optional[int] = None
    mode: Optional[str] = None
    enabled: Optional[int] = None
    auto_withdraw: Optional[int] = None
    withdraw_amount: Optional[float] = None
    pay_password: Optional[str] = None
    withdraw_wallet: Optional[int] = None
    window_start: Optional[str] = None
    window_end: Optional[str] = None


class WithdrawRequest(BaseModel):
    amount: Optional[float] = None
    pay_password: Optional[str] = None
    withdraw_wallet: Optional[int] = None
    bypass_time_window: Optional[bool] = False


class SettingsUpdate(BaseModel):
    telegram_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    base_url: Optional[str] = None
    schedule_time: Optional[str] = None
    schedule_time_2: Optional[str] = None
    schedule_enabled: Optional[str] = None
    auto_retry_outside_hours: Optional[str] = None
    retry_interval_minutes: Optional[str] = None
    min_withdrawal_spacing_minutes: Optional[str] = None
    max_withdrawal_spacing_minutes: Optional[str] = None
    midnight_scheduler_enabled: Optional[str] = None
    min_task_spacing_minutes: Optional[str] = None
    max_task_spacing_minutes: Optional[str] = None
    default_window_start: Optional[str] = None
    default_window_end: Optional[str] = None
    slot_duration_minutes: Optional[str] = None
    missed_window_policy: Optional[str] = None
    late_run_cutoff: Optional[str] = None


class TelegramTestRequest(BaseModel):
    telegram_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None


class LoginRequest(BaseModel):
    password: str


class AccountVerifyRequest(BaseModel):
    account_id: Optional[int] = None
    phone: str
    password: Optional[str] = ""


class CsvImportRequest(BaseModel):
    csv_text: str



# ==============================================================================
# Authentication & View Routes
# ==============================================================================
@app.get("/login", response_class=HTMLResponse)
def login_view(request: Request):
    if is_authenticated(request):
        return RedirectResponse(url="/", status_code=302)
    login_path = os.path.join(STATIC_DIR, "login.html")
    if os.path.exists(login_path):
        return FileResponse(login_path)
    return HTMLResponse("<h1>Login page missing</h1>")


# Each screen is its own HTML file (modular frontend).
PAGE_FILES = {
    "/": "index.html",
    "/accounts": "accounts.html",
    "/terminal": "terminal.html",
    "/history": "history.html",
    "/withdrawals": "withdrawals.html",
    "/settings": "settings.html",
}


@app.get("/", response_class=HTMLResponse)
@app.get("/accounts", response_class=HTMLResponse)
@app.get("/terminal", response_class=HTMLResponse)
@app.get("/history", response_class=HTMLResponse)
@app.get("/withdrawals", response_class=HTMLResponse)
@app.get("/settings", response_class=HTMLResponse)
def dashboard_view(request: Request):
    if not is_authenticated(request):
        return RedirectResponse(url="/login", status_code=302)
    page_path = os.path.join(STATIC_DIR, PAGE_FILES.get(request.url.path, "index.html"))
    if os.path.exists(page_path):
        return FileResponse(page_path)
    return HTMLResponse("<h1>Ace775 Dashboard static file missing.</h1>")


@app.post("/api/auth/login")
def login_api(item: LoginRequest):
    if not db.verify_dashboard_password(item.password):
        raise HTTPException(status_code=401, detail="Incorrect master password")

    token = secrets.token_hex(24)
    ACTIVE_SESSIONS.add(token)
    SESSION_LAST_ACTIVE[token] = time.time()

    response = JSONResponse(content={"success": True, "token": token})
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=86400 * 30,  # 30 days
        httponly=True,
        samesite="lax",
        path="/"
    )
    return response


@app.post("/api/auth/logout")
def logout_api(request: Request):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        ACTIVE_SESSIONS.discard(token)
        SESSION_LAST_ACTIVE.pop(token, None)
    response = JSONResponse(content={"success": True})
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return response


@app.get("/api/auth/check")
def auth_check_api(request: Request):
    return {"authenticated": is_authenticated(request)}



@app.get("/api/accounts")
def get_accounts_api():
    return db.get_accounts()


@app.post("/api/accounts/verify")
def verify_account_api(item: AccountVerifyRequest):
    clean_phone = db.normalize_phone(item.phone)
    if not clean_phone:
        raise HTTPException(status_code=400, detail="Phone number is required")

    target_pwd = item.password.strip() if item.password else ""
    # If editing an existing account and password field was left blank or is masked (e.g. ••••••••)
    if (not target_pwd or target_pwd.startswith("•") or target_pwd.startswith("*")) and item.account_id:
        acc = db.get_account(item.account_id, decrypt=True)
        if acc and acc.get("password"):
            target_pwd = acc["password"]

    if not target_pwd:
        raise HTTPException(status_code=400, detail="Password is required")

    base_url = db.get_setting("base_url", "https://ace775.com")
    bot = AceApiBot(base_url=base_url, phone=clean_phone, password=target_pwd)
    if bot.login():
        vip = bot.stats.get("grade", "VIP")
        bal = bot.stats.get("balance", "0.00")
        inc_bal = float(bot.stats.get("income_balance") or 0.0)
        pers_bal = float(bot.stats.get("personal_balance") or 0.0)
        w_amts = bot.stats.get("withdrawal_amounts") or [65, 170, 525, 1600, 4500, 14000, 33500, 65000, 150000, 200000, 500000, 1000000]
        w_fee = float(bot.stats.get("withdrawal_fee") or 0.0)

        # If existing account ID provided, update database stats immediately
        if item.account_id:
            db.update_account_stats(
                item.account_id,
                vip_level=vip,
                balance=bal,
                income_balance=inc_bal,
                personal_balance=pers_bal,
                withdrawal_amounts=w_amts,
                withdrawal_fee=w_fee,
                lifetime_tasks=bot.stats.get("lifetime_tasks"),
                lifetime_earned=bot.stats.get("lifetime_earned")
            )

        return {
            "valid": True,
            "phone": clean_phone,
            "vip_level": vip,
            "balance": bal,
            "income_balance": inc_bal,
            "personal_balance": pers_bal,
            "withdrawal_amounts": w_amts,
            "withdrawal_fee": w_fee,
            "message": f"Logins verified successfully! VIP: {vip} | Income: {inc_bal:.2f} GHS | Fee: {w_fee}%"
        }
    else:
        err = bot.stats.get("error", "Login failed. Please check credentials.")
        if err.startswith("Login failed: "):
            err = err[14:]
        return {
            "valid": False,
            "phone": clean_phone,
            "message": err
        }


@app.post("/api/accounts")
def create_account_api(item: AccountCreate):
    clean_phone = db.normalize_phone(item.phone)
    if not clean_phone or not item.password.strip():
        raise HTTPException(status_code=400, detail="Phone number and password are required")

    base_url = db.get_setting("base_url", "https://ace775.com")
    # Quick verification login against Ace775
    bot = AceApiBot(base_url=base_url, phone=clean_phone, password=item.password.strip())
    if not bot.login():
        err = bot.stats.get("error", "Login failed")
        if err.startswith("Login failed: "):
            err = err[14:]
        raise HTTPException(status_code=400, detail=f"Ace775 Verification Failed: {err}")

    try:
        acc = db.add_account(
            phone=clean_phone,
            password=item.password.strip(),
            label=item.label or "",
            max_tasks=item.max_tasks or 0,
            mode=item.mode or "api",
            enabled=item.enabled if item.enabled is not None else 1,
            auto_withdraw=item.auto_withdraw or 0,
            withdraw_amount=item.withdraw_amount or 0.0,
            pay_password=item.pay_password or "",
            withdraw_wallet=item.withdraw_wallet if item.withdraw_wallet is not None else 2,
            window_start=item.window_start or "",
            window_end=item.window_end or ""
        )
        vip = bot.stats.get("grade", "VIP")
        try:
            bal = float(bot.stats.get("balance", 0.0))
        except (ValueError, TypeError):
            bal = 0.0
        db.update_account_stats(
            acc["id"],
            vip_level=vip,
            balance=bal,
            income_balance=float(bot.stats.get("income_balance") or 0.0),
            personal_balance=float(bot.stats.get("personal_balance") or 0.0),
            withdrawal_amounts=bot.stats.get("withdrawal_amounts"),
            withdrawal_fee=bot.stats.get("withdrawal_fee"),
            last_status="Verified",
            lifetime_tasks=bot.stats.get("lifetime_tasks"),
            lifetime_earned=bot.stats.get("lifetime_earned"),
            tasks_done_today=bot.stats.get("tasks_done_today"),
            earned_today=bot.stats.get("today_earned")
        )
        broadcast_log(f"Verified & added account '{acc['label']}' ({clean_phone}) - VIP: {vip}, Balance: {bal} GHS", "success")
        return db.get_account(acc["id"])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to add account: {str(e)}")


@app.put("/api/accounts/{account_id}")
def update_account_api(account_id: int, item: AccountUpdate):
    existing = db.get_account(account_id, decrypt=True)
    if not existing:
        raise HTTPException(status_code=404, detail="Account not found")

    target_phone = db.normalize_phone(item.phone) if item.phone else existing["phone"]

    # Check if a genuine new password was provided (not masked bullets ••••••••)
    is_new_pwd = False
    if item.password and item.password.strip() and not item.password.startswith("•") and not item.password.startswith("*"):
        if item.password.strip() != existing["password"]:
            is_new_pwd = True

    target_pwd = item.password.strip() if is_new_pwd else existing["password"]

    # If phone or password changed, verify credentials with Ace775
    if (item.phone and target_phone != existing["phone"]) or is_new_pwd:
        base_url = db.get_setting("base_url", "https://ace775.com")
        bot = AceApiBot(base_url=base_url, phone=target_phone, password=target_pwd)
        if not bot.login():
            err = bot.stats.get("error", "Login failed")
            if err.startswith("Login failed: "):
                err = err[14:]
            raise HTTPException(status_code=400, detail=f"Ace775 Verification Failed: {err}")
        vip = bot.stats.get("grade", existing.get("vip_level", "VIP"))
        try:
            bal = float(bot.stats.get("balance", existing.get("balance", 0.0)))
        except (ValueError, TypeError):
            bal = existing.get("balance", 0.0)
        try:
            inc_bal = float(bot.stats.get("income_balance") or 0.0)
        except (ValueError, TypeError):
            inc_bal = 0.0
        try:
            pers_bal = float(bot.stats.get("personal_balance") or 0.0)
        except (ValueError, TypeError):
            pers_bal = 0.0

        db.update_account_stats(
            account_id,
            vip_level=vip,
            balance=bal,
            income_balance=inc_bal,
            personal_balance=pers_bal,
            withdrawal_amounts=bot.stats.get("withdrawal_amounts"),
            withdrawal_fee=bot.stats.get("withdrawal_fee"),
            last_status="Verified",
            lifetime_tasks=bot.stats.get("lifetime_tasks"),
            lifetime_earned=bot.stats.get("lifetime_earned"),
            tasks_done_today=bot.stats.get("tasks_done_today"),
            earned_today=bot.stats.get("today_earned")
        )

    # For saving: don't overwrite with masked bullet password
    save_pwd = item.password.strip() if is_new_pwd else None
    save_pay_pwd = None
    if item.pay_password and item.pay_password.strip() and not item.pay_password.startswith("•") and not item.pay_password.startswith("*"):
        save_pay_pwd = item.pay_password.strip()

    acc = db.update_account(
        account_id=account_id,
        phone=item.phone,
        password=save_pwd,
        label=item.label,
        max_tasks=item.max_tasks,
        mode=item.mode,
        enabled=item.enabled,
        auto_withdraw=item.auto_withdraw,
        withdraw_amount=item.withdraw_amount,
        pay_password=save_pay_pwd,
        withdraw_wallet=item.withdraw_wallet,
        window_start=item.window_start,
        window_end=item.window_end
    )
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    return acc


@app.post("/api/accounts/{account_id}/toggle-pause")
def toggle_account_pause_api(account_id: int):
    account = db.get_account(account_id, decrypt=False)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    current_enabled = int(account.get("enabled", 1))
    new_enabled = 0 if current_enabled == 1 else 1
    new_status = "Paused" if new_enabled == 0 else "Ready"

    updated = db.update_account(account_id, enabled=new_enabled)
    db.update_account_stats(account_id, last_status=new_status)

    label = account.get("label") or account.get("phone")
    if new_enabled == 0:
        broadcast_log(f"⏸️ Account '{label}' (+233 {account.get('phone')}) PAUSED. Task automation is suspended for this account.", "warning")
    else:
        broadcast_log(f"▶️ Account '{label}' (+233 {account.get('phone')}) RESUMED. Task automation is re-enabled for this account.", "success")

    return {
        "status": "success",
        "enabled": new_enabled,
        "is_paused": new_enabled == 0,
        "last_status": new_status,
        "account": updated
    }



@app.post("/api/accounts/{account_id}/refresh-balance")
def refresh_account_balance_api(account_id: int):
    account = db.get_account(account_id, decrypt=True)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    if account.get("password", "").startswith("enc:"):
        raise HTTPException(status_code=400, detail="Refresh failed: Could not decrypt account password. Master dashboard password may have changed.")

    base_url = db.get_setting("base_url", "https://ace775.com")
    bot = AceApiBot(base_url=base_url, phone=account["phone"], password=account["password"])
    if not bot.login():
        err = bot.stats.get("error", "Login failed. Could not refresh balance.")
        if err.startswith("Login failed: "):
            err = err[14:]
        raise HTTPException(status_code=400, detail=f"Refresh failed: {err}")

    vip = bot.stats.get("grade", account.get("vip_level", "VIP"))
    try:
        bal = float(bot.stats.get("balance", account.get("balance", 0.0)))
    except (ValueError, TypeError):
        bal = account.get("balance", 0.0)

    try:
        inc_bal = float(bot.stats.get("income_balance") or 0.0)
    except (ValueError, TypeError):
        inc_bal = 0.0

    try:
        pers_bal = float(bot.stats.get("personal_balance") or 0.0)
    except (ValueError, TypeError):
        pers_bal = 0.0

    db.update_account_stats(
        account_id,
        vip_level=vip,
        balance=bal,
        income_balance=inc_bal,
        personal_balance=pers_bal,
        withdrawal_amounts=bot.stats.get("withdrawal_amounts"),
        withdrawal_fee=bot.stats.get("withdrawal_fee"),
        last_status="Balance Refreshed",
        lifetime_tasks=bot.stats.get("lifetime_tasks"),
        lifetime_earned=bot.stats.get("lifetime_earned"),
        tasks_done_today=bot.stats.get("tasks_done_today"),
        earned_today=bot.stats.get("today_earned")
    )
    lt_tasks = bot.stats.get("lifetime_tasks", 0)
    lt_earned = bot.stats.get("lifetime_earned", 0.0)
    broadcast_log(f"🔄 Refreshed '{account.get('label') or account['phone']}': VIP {vip} | Balance {bal} GHS (Income: {inc_bal:.2f} GHS) | Lifetime: {lt_tasks} tasks (+{lt_earned:.2f} GHS)", "info")
    return db.get_account(account_id, decrypt=False)


@app.get("/api/accounts/{account_id}/withdrawal-options")
def get_account_withdrawal_options_api(account_id: int, refresh: bool = False):
    """
    Dynamically fetches or reads the exact withdrawal amounts and platform fee
    allowed for this specific account's VIP grade on Ace775.
    """
    account = db.get_account(account_id, decrypt=True)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    w_amts = account.get("withdrawal_amounts") or []
    # If refresh is requested or if account doesn't have tiers saved yet, fetch live from Ace775
    if refresh or not w_amts or len(w_amts) <= 1:
        base_url = db.get_setting("base_url", "https://ace775.com")
        bot = AceApiBot(base_url=base_url, phone=account["phone"], password=account["password"])
        if bot.login():
            vip = bot.stats.get("grade", account.get("vip_level", "VIP"))
            w_amts = bot.stats.get("withdrawal_amounts") or [65, 170, 525, 1600, 4500, 14000, 33500, 65000, 150000, 200000, 500000, 1000000]
            w_fee = float(bot.stats.get("withdrawal_fee") or 0.0)
            inc_bal = float(bot.stats.get("income_balance") or 0.0)
            pers_bal = float(bot.stats.get("personal_balance") or 0.0)
            bal = float(bot.stats.get("balance") or 0.0)
            db.update_account_stats(
                account_id,
                vip_level=vip,
                balance=bal,
                income_balance=inc_bal,
                personal_balance=pers_bal,
                withdrawal_amounts=w_amts,
                withdrawal_fee=w_fee,
                lifetime_tasks=bot.stats.get("lifetime_tasks"),
                lifetime_earned=bot.stats.get("lifetime_earned"),
                tasks_done_today=bot.stats.get("tasks_done_today"),
                earned_today=bot.stats.get("today_earned")
            )
            account = db.get_account(account_id, decrypt=False)

    min_w = w_amts[0] if w_amts else 65.0
    return {
        "ok": True,
        "account_id": account_id,
        "phone": account["phone"],
        "label": account.get("label") or account["phone"],
        "vip_level": account.get("vip_level") or "N/A",
        "income_balance": float(account.get("income_balance") or 0.0),
        "personal_balance": float(account.get("personal_balance") or 0.0),
        "total_balance": float(account.get("balance") or 0.0),
        "withdrawal_amounts": w_amts,
        "withdrawal_fee": float(account.get("withdrawal_fee") or 0.0),
        "min_amount": min_w,
        "auto_withdraw": account.get("auto_withdraw", 0),
        "configured_withdraw_amount": float(account.get("withdraw_amount") or 0.0),
        "withdraw_wallet": int(account.get("withdraw_wallet") or 2),
        "last_withdraw_status": account.get("last_withdraw_status", ""),
        "last_withdraw_date": account.get("last_withdraw_date", "")
    }


@app.post("/api/accounts/{account_id}/withdraw")
@app.post("/api/accounts/{account_id}/withdraw-now")
def withdraw_account_now_api(account_id: int, item: Optional[WithdrawRequest] = None):
    account = db.get_account(account_id, decrypt=True)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    phone = account["phone"]
    pwd = account["password"]
    label = account.get("label") or phone
    base_url = db.get_setting("base_url", "https://ace775.com")

    # Time and once-a-day checks
    bypass_time = item.bypass_time_window if item else False
    can_w, reason = db.can_withdraw_today(account, enforce_time_window=not bypass_time)
    if not can_w:
        raise HTTPException(status_code=400, detail=reason)

    pay_pwd = (item.pay_password if item and item.pay_password else None) or account.get("pay_password")
    if not pay_pwd:
        raise HTTPException(status_code=400, detail="Transaction payment password is required. Please set it in Account settings.")

    w_flag = (item.withdraw_wallet if item and item.withdraw_wallet is not None else None) or account.get("withdraw_wallet", 2)
    if w_flag == 2:
        try:
            available_bal = float(account.get("income_balance") or 0.0)
        except (ValueError, TypeError):
            available_bal = 0.0
        if available_bal <= 0:
            try:
                available_bal = float(account.get("balance") or 0.0)
            except (ValueError, TypeError):
                available_bal = 0.0
        wallet_name = "Income Wallet"
    else:
        try:
            available_bal = float(account.get("personal_balance") or 0.0)
        except (ValueError, TypeError):
            available_bal = 0.0
        if available_bal <= 0:
            try:
                available_bal = float(account.get("balance") or 0.0)
            except (ValueError, TypeError):
                available_bal = 0.0
        wallet_name = "Personal Wallet"

    raw_denominations = account.get("withdrawal_amounts") or [65, 170, 525, 1600, 4500, 14000, 33500, 65000, 150000, 200000, 500000, 1000000]
    allowed_denominations = sorted([float(x) for x in raw_denominations])
    min_amount = allowed_denominations[0] if allowed_denominations else 65.0

    amount = item.amount if item and item.amount and item.amount > 0 else float(account.get("withdraw_amount") or 0.0)
    if amount <= 0:
        amount = available_bal

    if amount < min_amount:
        raise HTTPException(status_code=400, detail=f"Minimum platform withdrawal for this VIP level is {min_amount:.2f} GHS. Current {wallet_name} balance is {available_bal:.2f} GHS.")

    if available_bal < amount:
        raise HTTPException(status_code=400, detail=f"Insufficient funds: {wallet_name} balance ({available_bal:.2f} GHS) is less than requested withdrawal amount ({amount:.2f} GHS).")

    bot = AceApiBot(base_url=base_url, phone=phone, password=pwd)
    res = bot.apply_withdrawal(amount=amount, pay_password=pay_pwd, withdrawl_flag=w_flag, bypass_time_window=bypass_time)

    tg_token = db.get_setting("telegram_token", os.getenv("TELEGRAM_BOT_TOKEN", ""))
    tg_chat = db.get_setting("telegram_chat_id", os.getenv("TELEGRAM_CHAT_ID", ""))
    reporter = TelegramReporter(bot_token=tg_token, chat_id=tg_chat)

    if res.get("success"):
        w_msg = f"Submitted {amount:.2f} GHS"
        db.update_account_withdrawal_status(account_id, status=w_msg)
        broadcast_log(f"💸 [Withdrawal] Manual request for '{label}': {w_msg}", "success")
        if reporter.is_configured:
            reporter.send_withdrawal_alert(label, phone, amount, "Submitted Successfully", res.get("message", ""))
        return {"success": True, "message": res.get("message", "Withdrawal submitted successfully"), "account": db.get_account(account_id, decrypt=False)}
    else:
        fail_msg = f"Failed: {res.get('message', 'Unknown error')}"
        db.update_account_withdrawal_status(account_id, status=fail_msg)
        broadcast_log(f"❌ [Withdrawal] Manual request for '{label}': {fail_msg}", "error")
        if reporter.is_configured:
            reporter.send_withdrawal_alert(label, phone, amount, "Failed", fail_msg)
        raise HTTPException(status_code=400, detail=res.get("message", "Withdrawal application failed"))


@app.post("/api/accounts/{account_id}/enqueue-withdrawal")
def enqueue_account_withdrawal_api(account_id: int, item: Optional[WithdrawRequest] = None):
    account = db.get_account(account_id, decrypt=True)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    pay_pwd = (item.pay_password if item and item.pay_password else None) or account.get("pay_password")
    if not pay_pwd:
        raise HTTPException(status_code=400, detail="Transaction PIN/password is required. Please set it in Account settings.")

    w_flag = (item.withdraw_wallet if item and item.withdraw_wallet is not None else None) or account.get("withdraw_wallet", 2)
    amount = (item.amount if item and item.amount and item.amount > 0 else None) or float(account.get("withdraw_amount") or 0.0)

    # Determine default minimum denomination if amount <= 0
    raw_denominations = account.get("withdrawal_amounts") or [65, 170, 525, 1600, 4500, 14000, 33500, 65000, 150000, 200000, 500000, 1000000]
    min_amount = min([float(x) for x in raw_denominations]) if raw_denominations else 65.0
    if amount < min_amount:
        amount = min_amount

    phone = account["phone"]
    label = account.get("label") or phone

    res = db.enqueue_withdrawal(
        account_id=account_id,
        phone=phone,
        label=label,
        amount=amount,
        wallet_flag=w_flag,
        pay_password=pay_pwd
    )
    if not res.get("queued"):
        raise HTTPException(status_code=400, detail=res.get("message", "Could not queue withdrawal."))

    broadcast_log(
        f"📥 [Withdrawal Queue] '{label}' manually queued for {amount:.2f} GHS! Scheduled for {res.get('scheduled_for')} (Randomized spacing within 09:00-17:00).",
        "info"
    )
    return res


@app.get("/api/withdrawals/queue")
def get_withdrawal_queue_api():
    return {
        "queue": db.get_withdrawal_queue(limit=50),
        "min_spacing": int(db.get_setting("min_withdrawal_spacing_minutes", "25") or "25"),
        "max_spacing": int(db.get_setting("max_withdrawal_spacing_minutes", "50") or "50"),
        "window": "09:00 - 17:00 (Mon - Fri)"
    }


@app.post("/api/withdrawals/queue/{queue_id}/cancel")
def cancel_withdrawal_queue_api(queue_id: int):
    ok = db.cancel_queued_withdrawal(queue_id)
    if not ok:
        raise HTTPException(status_code=400, detail="Could not cancel queued item (it may have already been executed or does not exist).")
    broadcast_log(f"🚫 Withdrawal Queue item #{queue_id} was cancelled by operator.", "warning")
    return {"status": "cancelled", "queue_id": queue_id}


@app.post("/api/accounts/import-csv")
def import_accounts_csv_api(item: CsvImportRequest):
    lines = item.csv_text.strip().splitlines()
    if not lines:
        raise HTTPException(status_code=400, detail="CSV is empty")

    base_url = db.get_setting("base_url", "https://ace775.com")
    imported = 0
    errors = []

    for line_idx, raw_line in enumerate(lines, 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 2:
            errors.append(f"Line {line_idx}: Missing phone or password")
            continue

        raw_phone, raw_pwd = parts[0], parts[1]
        if raw_phone.lower() in ["phone", "phonenumber", "phone_number", "mobile", "account"] or raw_pwd.lower() in ["password", "pwd", "pass"]:
            continue
        label = parts[2] if len(parts) > 2 else ""
        mode = parts[3] if len(parts) > 3 and parts[3] in ["api", "browser"] else "api"
        max_tasks = int(parts[4]) if len(parts) > 4 and parts[4].isdigit() else 0

        clean_phone = db.normalize_phone(raw_phone)
        if not clean_phone or not raw_pwd:
            errors.append(f"Line {line_idx}: Invalid phone or password")
            continue

        bot = AceApiBot(base_url=base_url, phone=clean_phone, password=raw_pwd)
        if not bot.login():
            err = bot.stats.get("error", "Login failed")
            if err.startswith("Login failed: "):
                err = err[14:]
            errors.append(f"Line {line_idx} ({raw_phone}): {err}")
            continue

        try:
            vip = bot.stats.get("grade", "VIP")
            try:
                bal = float(bot.stats.get("balance", 0.0))
            except (ValueError, TypeError):
                bal = 0.0
            acc = db.add_account(phone=clean_phone, password=raw_pwd, label=label, mode=mode, max_tasks=max_tasks)
            db.update_account_stats(
                acc["id"],
                vip_level=vip,
                balance=bal,
                last_status="Verified",
                lifetime_tasks=bot.stats.get("lifetime_tasks"),
                lifetime_earned=bot.stats.get("lifetime_earned"),
                tasks_done_today=bot.stats.get("tasks_done_today"),
                earned_today=bot.stats.get("today_earned")
            )
            imported += 1
        except Exception as e:
            errors.append(f"Line {line_idx} ({raw_phone}): {str(e)}")

    broadcast_log(f"📥 Batch CSV Import: {imported} account(s) added, {len(errors)} error(s).", "success" if imported > 0 else "warning")
    return {"imported": imported, "errors": errors}


@app.get("/api/history")
def get_run_history_api(account_id: Optional[int] = None, limit: int = 50):
    return db.get_run_history(account_id=account_id, limit=limit)


@app.get("/api/export/csv")
def export_csv_report():
    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow(["=== ACE775 7-DAY EARNINGS & TASKS REPORT ==="])
    writer.writerow(["Date", "Tasks Completed", "Earned (GHS)"])
    for r in db.get_last_7_days_analytics():
        writer.writerow([r["date"], r["tasks"], r["earned"]])
    writer.writerow([])

    writer.writerow(["=== ACCOUNTS OVERVIEW & LIFETIME METRICS ==="])
    writer.writerow(["ID", "Phone", "Label", "Mode", "VIP Level", "Balance (GHS)", "Today Tasks", "Today Earned (GHS)", "Lifetime Tasks", "Lifetime Earned (GHS)", "Last Status"])
    for a in db.get_accounts(mask_passwords=True):
        writer.writerow([
            a["id"], a["phone"], a.get("label", ""), a.get("mode", "api"),
            a.get("vip_level", "N/A"), a.get("balance", "0"),
            a.get("tasks_done_today", 0), a.get("earned_today", 0.0),
            a.get("total_tasks_done", 0), a.get("total_earned_ghs", 0.0),
            a.get("last_status", "")
        ])
    writer.writerow([])

    writer.writerow(["=== RECENT EXECUTION AUDIT LOG ==="])
    writer.writerow(["Run Time", "Account Label", "Phone", "Status", "Tasks Completed", "Earned (GHS)", "Balance (GHS)"])
    for h in db.get_run_history(limit=150):
        writer.writerow([h.get("run_time"), h.get("label"), h.get("phone"), h.get("status"), h.get("tasks_done"), h.get("earned"), h.get("balance")])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=ace775_financial_report.csv"}
    )


@app.delete("/api/accounts/{account_id}")
def delete_account_api(account_id: int):
    ok = db.delete_account(account_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Account not found")
    broadcast_log(f"Deleted account ID {account_id}", "warning")
    return {"status": "deleted"}


@app.post("/api/accounts/{account_id}/run")
def trigger_single_run(account_id: int, background_tasks: BackgroundTasks):
    account = db.get_account(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if account.get("enabled", 1) == 0:
        label = account.get("label") or account.get("phone")
        return JSONResponse(status_code=400, content={
            "status": "paused",
            "message": f"Account '{label}' is currently PAUSED. Click '▶️ Resume' on the dashboard to re-enable task execution."
        })
    if db.utc_now().weekday() == 6:
        broadcast_log("⏸️ [Sunday Rest Day] Ace775 platform is closed on Sundays. Tasks suspended today.", "warning")
        db.update_account_stats(account_id, last_status="Sunday: Rest Day")
        return {"status": "skipped", "message": "Sunday: Ace775 platform is closed for tasks"}
    background_tasks.add_task(run_single_account, account_id, True)
    return {"status": "started", "message": f"Run queued for {account['phone']}"}


@app.post("/api/run-all")
def trigger_run_all(background_tasks: BackgroundTasks):
    if db.utc_now().weekday() == 6:
        broadcast_log("⏸️ [Sunday Rest Day] Ace775 platform is closed on Sundays. Batch automation suspended today.", "warning")
        return {"status": "skipped", "message": "Sunday: Ace775 platform is closed for tasks"}
    if _batch_running():
        return JSONResponse(status_code=400, content={"status": "busy", "message": "A job is already running!"})
    background_tasks.add_task(run_all_enabled_accounts)
    return {"status": "started", "message": "Batch execution started in background"}


@app.get("/api/stats")
def get_stats_api():
    return db.get_dashboard_stats()


@app.get("/api/analytics/7days")
def get_7days_analytics():
    return db.get_last_7_days_analytics()


@app.get("/api/scheduler")
def get_scheduler_status():
    return scheduler.get_status()


@app.get("/api/logs/history")
def get_log_history():
    return log_history


@app.get("/api/logs/stream")
async def stream_logs(request: Request):
    queue = asyncio.Queue()
    log_subscribers.append(queue)

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    entry = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {entry['timestamp']} [{entry['level'].upper()}] {entry['message']}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            if queue in log_subscribers:
                log_subscribers.remove(queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/run/active")
def get_active_runs():
    return {
        "running_ids": list(RUNNING_ACCOUNT_IDS),
        "is_batch_running": _batch_running()
    }


# ==============================================================================
# System Update (git pull + service restart) - surfaced on the Settings page
# ==============================================================================
APP_DIR = os.path.dirname(os.path.abspath(__file__))
_update_lock = threading.Lock()


def _git(args, timeout=45):
    """Run a fixed git command inside the project directory. No user input is interpolated."""
    return subprocess.run(["git"] + args, cwd=APP_DIR, capture_output=True, text=True, timeout=timeout)


def _system_version_info(refresh: bool = False) -> Dict[str, Any]:
    """Report the revision this host is running, optionally after fetching from origin."""
    info: Dict[str, Any] = {"branch": "", "commit": "", "subject": "", "date": "",
                            "ahead": 0, "behind": 0, "dirty": False}
    try:
        info["branch"] = _git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip() or "main"
        info["commit"] = _git(["rev-parse", "--short", "HEAD"]).stdout.strip()
        last = _git(["log", "-1", "--pretty=%s|%cd", "--date=format:%Y-%m-%d %H:%M"]).stdout.strip()
        if "|" in last:
            info["subject"], info["date"] = last.split("|", 1)
        info["dirty"] = bool(_git(["status", "--porcelain"]).stdout.strip())
        if refresh:
            _git(["fetch", "--quiet", "origin", info["branch"]], timeout=60)
            counts = _git(["rev-list", "--left-right", "--count", "HEAD...@{u}"]).stdout.split()
            if len(counts) == 2:
                info["ahead"], info["behind"] = int(counts[0]), int(counts[1])
    except Exception as exc:
        info["error"] = str(exc)
    return info


def _schedule_restart() -> bool:
    """Restart the service without cutting off the in-flight HTTP response.

    A detached shell waits a moment, then asks systemd to restart the unit. If that is not
    permitted it kills this process instead, and the unit's Restart=always brings it back.
    Returns False when there is no unit to restart, so the caller can tell the operator to
    restart it by hand rather than claiming the code was reloaded.
    """
    if os.name == "nt":
        return False
    try:
        active = subprocess.run(["systemctl", "is-active", "--quiet", "ace775"], timeout=5).returncode == 0
    except Exception:
        active = False
    if not active:
        return False
    app_path = shlex.quote(os.path.join(APP_DIR, "app.py"))
    cmd = "sleep 2; sudo -n systemctl restart ace775 2>/dev/null || pkill -f %s || true" % app_path
    try:
        subprocess.Popen(["bash", "-lc", cmd], cwd=APP_DIR, start_new_session=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception:
        return False


class SystemUpdateRequest(BaseModel):
    password: str
    restart: Optional[bool] = True


@app.get("/api/system/version")
def get_system_version(check: bool = False):
    """Installed revision, and on request whether origin has newer commits."""
    return _system_version_info(refresh=check)


@app.post("/api/system/update")
def system_update(item: SystemUpdateRequest):
    """Pull the latest code from origin and restart the service (Settings page button)."""
    if not db.verify_dashboard_password(item.password):
        raise HTTPException(status_code=401, detail="Master password is incorrect.")
    if _batch_running():
        raise HTTPException(status_code=409, detail="A batch run is in progress. Wait for it to finish before updating.")
    if not _update_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="An update is already in progress.")
    try:
        branch = _git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip() or "main"
        before = _git(["rev-parse", "HEAD"]).stdout.strip()

        pull = _git(["pull", "--ff-only", "origin", branch], timeout=120)
        output = ((pull.stdout or "") + (pull.stderr or "")).strip()
        if pull.returncode != 0:
            raise HTTPException(status_code=400, detail="git pull failed:\n" + (output or "unknown error"))

        after = _git(["rev-parse", "HEAD"]).stdout.strip()
        updated = bool(before and after and before != after)
        changed = _git(["diff", "--name-only", before, after]).stdout.split() if updated else []

        deps_refreshed = False
        if "requirements.txt" in changed:
            try:
                pip_run = subprocess.run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt", "--quiet"],
                                         cwd=APP_DIR, capture_output=True, text=True, timeout=300)
                deps_refreshed = pip_run.returncode == 0
                if not deps_refreshed:
                    output += "\nDependency install failed:\n" + (pip_run.stderr or "")[-500:]
            except Exception as exc:
                output += "\nDependency install error: %s" % exc

        restarting = bool(item.restart) and _schedule_restart()
        broadcast_log("[SYSTEM] Update requested: %s" % ("pulled new code" if updated else "already up to date"),
                      "success")
        return {
            "success": True,
            "updated": updated,
            "output": output or "Already up to date.",
            "changed_files": changed,
            "dependencies_refreshed": deps_refreshed,
            "restarting": restarting,
            "version": _system_version_info(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Update failed: %s" % exc)
    finally:
        _update_lock.release()


@app.get("/api/windows/plan")
def get_windows_plan():
    """Preview of today's window layout: which accounts share a window, capacity and issues."""
    spacing = int(db.get_setting("min_task_spacing_minutes", "15") or "15")
    duration = int(db.get_setting("slot_duration_minutes", "10") or "10")
    cutoff = db.hhmm_to_min(db.get_setting("late_run_cutoff", "23:00")) or 23 * 60
    policy = db.get_setting("missed_window_policy", "late")

    entries = []
    for account in db.get_accounts():
        if not account.get("enabled", 1):
            continue
        start_min, end_min, source = db.resolve_window(account)
        entries.append({
            "id": account["id"],
            "label": account.get("label") or account["phone"],
            "phone": account["phone"],
            "start": start_min,
            "end": end_min,
            "source": source,
        })

    now = db.utc_now()
    plan = plan_task_slots(entries, now.hour * 60 + now.minute, spacing, duration, cutoff, policy)
    slots = {s["account_id"]: s for s in plan["slots"]}

    windows = {}
    for entry in entries:
        key = "%s - %s" % (db.min_to_hhmm(entry["start"]), db.min_to_hhmm(entry["end"]))
        slot = slots.get(entry["id"])
        windows.setdefault(key, {"window": key, "accounts": [], "capacity": 0,
                                 "length_minutes": entry["end"] - entry["start"]})["accounts"].append({
            "id": entry["id"],
            "label": entry["label"],
            "window_source": entry["source"],
            "slot": db.min_to_hhmm(slot["start"]) if slot else None,
            "late": bool(slot and slot["late"]),
        })

    out = []
    for key in sorted(windows):
        item = windows[key]
        length = item["length_minutes"]
        item["capacity"] = max(0, (length - duration) // spacing + 1) if length > duration else 0
        item["count"] = len(item["accounts"])
        item["ok"] = item["count"] <= item["capacity"]
        out.append(item)

    return {
        "windows": out,
        "problems": plan["problems"],
        "skipped": plan["skipped"],
        "spacing_minutes": spacing,
        "slot_duration_minutes": duration,
        "late_run_cutoff": db.min_to_hhmm(cutoff),
        "missed_window_policy": policy,
    }


@app.get("/api/settings")
def get_settings_api():
    return {
        "telegram_token": db.get_setting("telegram_token", os.getenv("TELEGRAM_BOT_TOKEN", "")),
        "telegram_chat_id": db.get_setting("telegram_chat_id", os.getenv("TELEGRAM_CHAT_ID", "")),
        "base_url": db.get_setting("base_url", "https://ace775.com"),
        "schedule_time": db.get_setting("schedule_time", "09:00"),
        "schedule_time_2": db.get_setting("schedule_time_2", ""),
        "schedule_enabled": db.get_setting("schedule_enabled", "1"),
        "auto_retry_outside_hours": db.get_setting("auto_retry_outside_hours", "1"),
        "retry_interval_minutes": db.get_setting("retry_interval_minutes", "30"),
        "min_withdrawal_spacing_minutes": db.get_setting("min_withdrawal_spacing_minutes", "25"),
        "max_withdrawal_spacing_minutes": db.get_setting("max_withdrawal_spacing_minutes", "50"),
        "midnight_scheduler_enabled": db.get_setting("midnight_scheduler_enabled", "1"),
        "min_task_spacing_minutes": db.get_setting("min_task_spacing_minutes", "15"),
        "max_task_spacing_minutes": db.get_setting("max_task_spacing_minutes", "35"),
        "default_window_start": db.get_setting("default_window_start", "04:00"),
        "default_window_end": db.get_setting("default_window_end", "08:00"),
        "slot_duration_minutes": db.get_setting("slot_duration_minutes", "10"),
        "missed_window_policy": db.get_setting("missed_window_policy", "late"),
        "late_run_cutoff": db.get_setting("late_run_cutoff", "23:00")
    }


@app.post("/api/settings")
def update_settings_api(data: SettingsUpdate):
    if data.telegram_token is not None:
        db.set_setting("telegram_token", data.telegram_token.strip())
    if data.telegram_chat_id is not None:
        db.set_setting("telegram_chat_id", data.telegram_chat_id.strip())
    if data.base_url is not None:
        db.set_setting("base_url", data.base_url.strip())
    if data.schedule_time is not None:
        db.set_setting("schedule_time", data.schedule_time.strip())
    if data.schedule_time_2 is not None:
        db.set_setting("schedule_time_2", data.schedule_time_2.strip())
    if data.schedule_enabled is not None:
        db.set_setting("schedule_enabled", data.schedule_enabled.strip())
    if data.auto_retry_outside_hours is not None:
        db.set_setting("auto_retry_outside_hours", data.auto_retry_outside_hours.strip())
    if data.retry_interval_minutes is not None:
        db.set_setting("retry_interval_minutes", data.retry_interval_minutes.strip())
    if data.min_withdrawal_spacing_minutes is not None:
        db.set_setting("min_withdrawal_spacing_minutes", data.min_withdrawal_spacing_minutes.strip())
    if data.max_withdrawal_spacing_minutes is not None:
        db.set_setting("max_withdrawal_spacing_minutes", data.max_withdrawal_spacing_minutes.strip())
    if data.midnight_scheduler_enabled is not None:
        db.set_setting("midnight_scheduler_enabled", data.midnight_scheduler_enabled.strip())
    if data.min_task_spacing_minutes is not None:
        db.set_setting("min_task_spacing_minutes", data.min_task_spacing_minutes.strip())
    if data.max_task_spacing_minutes is not None:
        db.set_setting("max_task_spacing_minutes", data.max_task_spacing_minutes.strip())
    if data.default_window_start is not None:
        db.set_setting("default_window_start", data.default_window_start.strip())
    if data.default_window_end is not None:
        db.set_setting("default_window_end", data.default_window_end.strip())
    if data.slot_duration_minutes is not None:
        db.set_setting("slot_duration_minutes", data.slot_duration_minutes.strip())
    if data.missed_window_policy is not None:
        db.set_setting("missed_window_policy", data.missed_window_policy.strip())
    if data.late_run_cutoff is not None:
        db.set_setting("late_run_cutoff", data.late_run_cutoff.strip())

    # Dynamically reload Telegram Listener (#3)
    if data.telegram_token is not None or data.telegram_chat_id is not None:
        try:
            telegram_bot.stop()
            telegram_bot.bot_token = db.get_setting("telegram_token", "")
            telegram_bot.authorized_chat_id = db.get_setting("telegram_chat_id", "")
            if telegram_bot.is_configured:
                telegram_bot.start()
                broadcast_log("📱 Telegram Listener reloaded live with new credentials.", "success")
            else:
                broadcast_log("📱 Telegram Listener stopped (credentials cleared).", "info")
        except Exception as e:
            logger.warning(f"Error reloading Telegram bot: {e}")

    broadcast_log("Settings and Auto-Scheduler updated.", "info")
    return {"status": "saved"}


@app.post("/api/settings/test-telegram")
def test_telegram_api(data: TelegramTestRequest):
    token = (data.telegram_token or db.get_setting("telegram_token", "")).strip()
    chat_id = (data.telegram_chat_id or db.get_setting("telegram_chat_id", "")).strip()
    if not token or not chat_id:
        raise HTTPException(status_code=400, detail="Telegram Bot Token and Chat ID are both required.")

    from ace_bot import TelegramReporter
    reporter = TelegramReporter(bot_token=token, chat_id=chat_id)
    now_str = db.utc_now().strftime("%Y-%m-%d %H:%M:%S")
    msg = (
        "<b>🔔 Ace775 Automation Alert</b>\n\n"
        "✅ <b>Telegram Connection Verified!</b>\n"
        f"Timestamp: <code>{now_str}</code>\n"
        "Your bot credentials and authorized chat ID are working properly."
    )
    try:
        ok = reporter.send_message(msg)
        if ok:
            return {"status": "ok", "message": "Test notification delivered to your Telegram chat!"}
        else:
            raise HTTPException(status_code=400, detail="Telegram rejected the message. Verify your bot token and chat ID.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))




# Serve the modular frontend from the site root (/css/*, /js/*, /accounts.html, ...).
# Registered last so the API and page routes above match first.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="root")


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    broadcast_log(f"Web Dashboard running on http://0.0.0.0:{port}", "info")
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
