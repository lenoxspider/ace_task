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
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn

import db
from ace_bot import AceApiBot, AcePlaywrightBot, TelegramReporter
from scheduler import scheduler
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
    if path.startswith("/static") or path in ["/login", "/api/auth/login", "/api/auth/check", "/favicon.ico"]:
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
is_running_lock = False
RUNNING_ACCOUNT_IDS: set = set()


def broadcast_log(message: str, level: str = "info"):
    """Broadcast a log entry to in-memory history and active SSE streams."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    entry = {"timestamp": timestamp, "message": message, "level": level}
    log_history.append(entry)
    if len(log_history) > MAX_LOG_HISTORY:
        log_history.pop(0)

    # Dispatch to SSE listeners
    dead_queues = []
    for q in log_subscribers:
        try:
            q.put_nowait(entry)
        except Exception:
            dead_queues.append(q)
    for dq in dead_queues:
        if dq in log_subscribers:
            log_subscribers.remove(dq)


# ==============================================================================
# Execution Workers with Anti-Ban Pacing
# ==============================================================================
def run_single_account(account_id: int):
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

    RUNNING_ACCOUNT_IDS.add(account_id)
    broadcast_log(f"[ACCOUNT_RUNNING:{account_id}]", "event")

    # Sunday Guard: Ace775 platform is closed for tasks on Sundays
    if datetime.now().weekday() == 6:
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
                reporter.send_error_alert(label, phone, stats["error"])

        db.update_account_stats(
            account_id,
            vip_level=grade,
            balance=balance,
            last_status=status_msg,
            tasks_done=len(tasks),
            earned=total_earned,
            lifetime_tasks=stats.get("lifetime_tasks"),
            lifetime_earned=stats.get("lifetime_earned"),
            tasks_done_today=stats.get("tasks_done_today"),
            earned_today=stats.get("today_earned")
        )

        broadcast_log(
            f"✅ Finished '{label}': VIP {grade}, Balance {balance} GHS, Tasks {len(tasks)}, Earned +{total_earned:.2f} GHS ({status_msg})",
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

            can_w, reason = db.can_withdraw_today(updated_account)
            if not can_w:
                broadcast_log(f"⏸️ [Auto-Withdraw] Held for '{label}': {reason}", "info")
            elif not pay_pwd:
                broadcast_log(f"⚠️ [Auto-Withdraw] Skipped for '{label}': Transaction PIN/password not configured.", "warning")
            else:
                try:
                    curr_bal = float(balance)
                except (ValueError, TypeError):
                    curr_bal = 0.0

                if w_amount > 0 and curr_bal < w_amount:
                    broadcast_log(f"⏸️ [Auto-Withdraw] Held for '{label}': Current balance ({curr_bal:.2f} GHS) below target ({w_amount:.2f} GHS).", "info")
                else:
                    target_withdraw = w_amount if w_amount > 0 else curr_bal
                    if target_withdraw > 0:
                        broadcast_log(f"💸 [Auto-Withdraw] Triggering withdrawal of {target_withdraw:.2f} GHS for '{label}'...", "info")
                        w_bot = AceApiBot(base_url=base_url, phone=phone, password=pwd)
                        w_res = w_bot.apply_withdrawal(amount=target_withdraw, pay_password=pay_pwd, withdrawl_flag=w_flag)
                        if w_res.get("success"):
                            w_msg = f"Submitted {target_withdraw:.2f} GHS"
                            db.update_account_withdrawal_status(account_id, status=w_msg)
                            broadcast_log(f"✅ [Auto-Withdraw] Success for '{label}': {w_msg}", "success")
                            if reporter.is_configured:
                                reporter.send_withdrawal_alert(label, phone, target_withdraw, "Submitted Successfully", w_res.get("message", ""))
                        else:
                            fail_msg = f"Failed: {w_res.get('message', 'Unknown error')}"
                            db.update_account_withdrawal_status(account_id, status=fail_msg)
                            broadcast_log(f"❌ [Auto-Withdraw] Failed for '{label}': {fail_msg}", "error")
                            if reporter.is_configured:
                                reporter.send_withdrawal_alert(label, phone, target_withdraw, "Failed", fail_msg)

    except Exception as e:
        err_str = str(e)
        logger.error(f"Error running account {phone}: {e}", exc_info=True)
        broadcast_log(f"❌ Error on '{label}': {err_str}", "error")
        db.update_account_stats(account_id, last_status=f"Failed: {err_str[:30]}")
        if reporter.is_configured:
            reporter.send_error_alert(label, phone, err_str)
    finally:
        RUNNING_ACCOUNT_IDS.discard(account_id)
        broadcast_log(f"[ACCOUNT_IDLE:{account_id}]", "event")


def run_all_enabled_accounts():
    global is_running_lock
    if is_running_lock:
        broadcast_log("⚠️ An execution job is already in progress!", "warning")
        return

    # Sunday Guard: Ace775 platform is closed for tasks on Sundays
    if datetime.now().weekday() == 6:
        broadcast_log("⏸️ [Sunday Rest Day] Ace775 platform is closed on Sundays. Batch automation suspended today.", "warning")
        return

    is_running_lock = True
    try:
        accounts = db.get_accounts()
        enabled_accounts = [a for a in accounts if a["enabled"]]
        broadcast_log(f"📋 Starting batch execution for {len(enabled_accounts)} active account(s)...", "info")

        for idx, acc in enumerate(enabled_accounts, 1):
            broadcast_log(f"\n--- Processing account {idx}/{len(enabled_accounts)}: {acc['phone']} ---", "info")
            run_single_account(acc["id"])

            # Account pacing: randomized pause before next account (15s - 25s)
            if idx < len(enabled_accounts):
                pacing = random.uniform(15.0, 25.0)
                broadcast_log(f"⏳ Account Pacing: waiting {pacing:.1f}s before next account...", "info")
                time.sleep(pacing)

        broadcast_log("🎉 Batch execution for all active accounts finished!", "success")
    finally:
        is_running_lock = False


# Connect callbacks to Scheduler and Telegram Listener
scheduler.run_all_callback = run_all_enabled_accounts
telegram_bot.run_all_callback = run_all_enabled_accounts


# ==============================================================================
# Lifecycle & Models
# ==============================================================================
@app.on_event("startup")
def on_startup():
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


@app.get("/", response_class=HTMLResponse)
@app.get("/accounts", response_class=HTMLResponse)
@app.get("/terminal", response_class=HTMLResponse)
@app.get("/history", response_class=HTMLResponse)
@app.get("/withdrawals", response_class=HTMLResponse)
@app.get("/settings", response_class=HTMLResponse)
def dashboard_view(request: Request):
    if not is_authenticated(request):
        return RedirectResponse(url="/login", status_code=302)
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
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
        return {
            "valid": True,
            "phone": clean_phone,
            "vip_level": vip,
            "balance": bal,
            "message": f"Logins verified successfully! VIP: {vip} | Balance: {bal} GHS"
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
            withdraw_wallet=item.withdraw_wallet if item.withdraw_wallet is not None else 2
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
        db.update_account_stats(
            account_id,
            vip_level=vip,
            balance=bal,
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
        withdraw_wallet=item.withdraw_wallet
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

    db.update_account_stats(
        account_id,
        vip_level=vip,
        balance=bal,
        last_status="Balance Refreshed",
        lifetime_tasks=bot.stats.get("lifetime_tasks"),
        lifetime_earned=bot.stats.get("lifetime_earned"),
        tasks_done_today=bot.stats.get("tasks_done_today"),
        earned_today=bot.stats.get("today_earned")
    )
    lt_tasks = bot.stats.get("lifetime_tasks", 0)
    lt_earned = bot.stats.get("lifetime_earned", 0.0)
    broadcast_log(f"🔄 Refreshed '{account.get('label') or account['phone']}': VIP {vip} | Balance {bal} GHS | Lifetime: {lt_tasks} tasks (+{lt_earned:.2f} GHS)", "info")
    return db.get_account(account_id, decrypt=False)


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

    amount = item.amount if item and item.amount and item.amount > 0 else float(account.get("withdraw_amount") or 0.0)
    if amount <= 0:
        try:
            amount = float(account.get("balance") or 0.0)
        except (ValueError, TypeError):
            amount = 0.0
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Please specify a valid withdrawal amount (> 0 GHS).")

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
    if datetime.now().weekday() == 6:
        broadcast_log("⏸️ [Sunday Rest Day] Ace775 platform is closed on Sundays. Tasks suspended today.", "warning")
        db.update_account_stats(account_id, last_status="Sunday: Rest Day")
        return {"status": "skipped", "message": "Sunday: Ace775 platform is closed for tasks"}
    background_tasks.add_task(run_single_account, account_id)
    return {"status": "started", "message": f"Run queued for {account['phone']}"}


@app.post("/api/run-all")
def trigger_run_all(background_tasks: BackgroundTasks):
    if datetime.now().weekday() == 6:
        broadcast_log("⏸️ [Sunday Rest Day] Ace775 platform is closed on Sundays. Batch automation suspended today.", "warning")
        return {"status": "skipped", "message": "Sunday: Ace775 platform is closed for tasks"}
    global is_running_lock
    if is_running_lock:
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
        "is_batch_running": is_running_lock
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
        "retry_interval_minutes": db.get_setting("retry_interval_minutes", "30")
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


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    broadcast_log(f"Web Dashboard running on http://0.0.0.0:{port}", "info")
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=False)
