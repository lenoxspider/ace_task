"""
Database management module for Ace775 Multi-Account Bot.
Stores accounts, settings, run statistics, and 7-day analytics in SQLite.
"""

import os
import sqlite3
import base64
import hashlib
import random
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta
from dotenv import load_dotenv
from cryptography.fernet import Fernet

load_dotenv()

DB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DB_PATH = os.path.join(DB_DIR, "accounts.db")


def normalize_phone(phone: str) -> str:
    """Normalize Ghana phone number to 9 digits (removing leading 0 or +233 prefix)."""
    p = str(phone).strip()
    if p.startswith("+233"):
        p = p[4:]
    elif p.startswith("233"):
        p = p[3:]
    elif p.startswith("0") and len(p) == 10:
        p = p[1:]
    return p


# ==============================================================================
# Security: AES-128-CBC / Fernet Reversible Encryption (#13)
# ==============================================================================
def _get_fernet() -> Fernet:
    pwd = get_dashboard_password()
    key_bytes = hashlib.sha256((pwd + "_ace775_security_pepper").encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(key_bytes))


def encrypt_password(plain_text: str) -> str:
    if not plain_text:
        return ""
    if plain_text.startswith("enc:"):
        return plain_text
    try:
        f = _get_fernet()
        token = f.encrypt(plain_text.encode("utf-8")).decode("utf-8")
        return f"enc:{token}"
    except Exception:
        return plain_text


def decrypt_password(cipher_text: str) -> str:
    if not cipher_text:
        return ""
    if not cipher_text.startswith("enc:"):
        return cipher_text
    try:
        f = _get_fernet()
        token = cipher_text[4:]
        return f.decrypt(token.encode("utf-8")).decode("utf-8")
    except Exception:
        return cipher_text


def get_connection() -> sqlite3.Connection:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create tables if they do not exist and seed default settings and accounts."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            label TEXT DEFAULT '',
            max_tasks INTEGER DEFAULT 0,
            mode TEXT DEFAULT 'api',
            enabled INTEGER DEFAULT 1,
            vip_level TEXT DEFAULT 'N/A',
            balance TEXT DEFAULT '0',
            last_run_time TEXT DEFAULT '',
            last_status TEXT DEFAULT 'Never run',
            tasks_done_today INTEGER DEFAULT 0,
            earned_today REAL DEFAULT 0.0,
            total_tasks_done INTEGER DEFAULT 0,
            total_earned_ghs REAL DEFAULT 0.0,
            created_at TEXT DEFAULT ''
        )
    """)

    # Run History table (#2)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS run_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER,
            phone TEXT,
            label TEXT,
            run_time TEXT,
            status TEXT,
            tasks_done INTEGER DEFAULT 0,
            earned REAL DEFAULT 0.0,
            balance TEXT DEFAULT '0'
        )
    """)

    # Migration: ensure lifetime and withdrawal columns exist for existing databases
    cursor.execute("PRAGMA table_info(accounts)")
    columns = [col["name"] for col in cursor.fetchall()]
    if "total_tasks_done" not in columns:
        cursor.execute("ALTER TABLE accounts ADD COLUMN total_tasks_done INTEGER DEFAULT 0")
    if "total_earned_ghs" not in columns:
        cursor.execute("ALTER TABLE accounts ADD COLUMN total_earned_ghs REAL DEFAULT 0.0")
    if "auto_withdraw" not in columns:
        cursor.execute("ALTER TABLE accounts ADD COLUMN auto_withdraw INTEGER DEFAULT 0")
    if "withdraw_amount" not in columns:
        cursor.execute("ALTER TABLE accounts ADD COLUMN withdraw_amount REAL DEFAULT 0.0")
    if "pay_password" not in columns:
        cursor.execute("ALTER TABLE accounts ADD COLUMN pay_password TEXT DEFAULT ''")
    if "withdraw_wallet" not in columns:
        cursor.execute("ALTER TABLE accounts ADD COLUMN withdraw_wallet INTEGER DEFAULT 2")
    if "last_withdraw_date" not in columns:
        cursor.execute("ALTER TABLE accounts ADD COLUMN last_withdraw_date TEXT DEFAULT ''")
    if "last_withdraw_status" not in columns:
        cursor.execute("ALTER TABLE accounts ADD COLUMN last_withdraw_status TEXT DEFAULT ''")
    if "income_balance" not in columns:
        cursor.execute("ALTER TABLE accounts ADD COLUMN income_balance REAL DEFAULT 0.0")
    if "personal_balance" not in columns:
        cursor.execute("ALTER TABLE accounts ADD COLUMN personal_balance REAL DEFAULT 0.0")
    if "withdrawal_amounts" not in columns:
        cursor.execute("ALTER TABLE accounts ADD COLUMN withdrawal_amounts TEXT DEFAULT ''")
    if "withdrawal_fee" not in columns:
        cursor.execute("ALTER TABLE accounts ADD COLUMN withdrawal_fee REAL DEFAULT 0.0")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS daily_records (
            date TEXT PRIMARY KEY,
            tasks_count INTEGER DEFAULT 0,
            earned_ghs REAL DEFAULT 0.0
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS withdrawal_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            phone TEXT NOT NULL,
            label TEXT DEFAULT '',
            amount REAL NOT NULL,
            wallet_flag INTEGER DEFAULT 2,
            pay_password TEXT DEFAULT '',
            status TEXT DEFAULT 'queued',
            queued_at TEXT NOT NULL,
            scheduled_for TEXT NOT NULL,
            executed_at TEXT DEFAULT '',
            result_message TEXT DEFAULT ''
        )
    """)
    conn.commit()

    # Seed initial settings
    defaults = {
        "schedule_time": "09:00",
        "schedule_time_2": "",
        "schedule_enabled": "1",
        "auto_retry_outside_hours": "1",
        "retry_interval_minutes": "30",
        "min_withdrawal_spacing_minutes": "25",
        "max_withdrawal_spacing_minutes": "50",
        "base_url": "https://ace775.com",
        "telegram_token": os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
        "telegram_chat_id": os.getenv("TELEGRAM_CHAT_ID", "").strip(),
        "dashboard_password": os.getenv("DASHBOARD_PASSWORD", "admin123").strip()
    }
    for k, v in defaults.items():
        cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v))
    conn.commit()

    # Seed initial account from .env if table is empty
    cursor.execute("SELECT COUNT(*) FROM accounts")
    count = cursor.fetchone()[0]
    if count == 0:
        env_phone = os.getenv("ACE_PHONE", "").strip()
        env_pwd = os.getenv("ACE_PASSWORD", "").strip()
        if env_phone and env_pwd:
            clean_phone = normalize_phone(env_phone)
            now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            cursor.execute("""
                INSERT OR IGNORE INTO accounts (phone, password, label, mode, max_tasks, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (clean_phone, env_pwd, "Main Account", "api", 0, now))
            conn.commit()

    conn.close()


DEFAULT_DENOMINATIONS = [65, 170, 525, 1600, 4500, 14000, 33500, 65000, 150000, 200000, 500000, 1000000]


def _parse_withdrawal_amounts(val: Any) -> List[float]:
    if not val:
        return list(DEFAULT_DENOMINATIONS)
    if isinstance(val, (list, tuple)):
        return [int(x) if float(x).is_integer() else float(x) for x in val]
    if isinstance(val, str):
        val = val.strip()
        if not val:
            return list(DEFAULT_DENOMINATIONS)
        parts = [p.strip() for p in (val.split("|") if "|" in val else val.split(","))]
        res = []
        for p in parts:
            try:
                num = float(p)
                res.append(int(num) if num.is_integer() else num)
            except ValueError:
                pass
        return res if res else list(DEFAULT_DENOMINATIONS)
    return list(DEFAULT_DENOMINATIONS)


def get_accounts(mask_passwords: bool = True) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM accounts ORDER BY id ASC")
    rows = []
    for r in cursor.fetchall():
        d = dict(r)
        if mask_passwords:
            d["password"] = "••••••••"
            d["pay_password"] = "••••••" if d.get("pay_password") else ""
        else:
            d["password"] = decrypt_password(d.get("password", ""))
            d["pay_password"] = decrypt_password(d.get("pay_password", ""))
        d["withdrawal_amounts"] = _parse_withdrawal_amounts(d.get("withdrawal_amounts"))
        d["withdrawal_fee"] = float(d.get("withdrawal_fee") or 0.0)
        rows.append(d)
    conn.close()
    return rows


def get_account(account_id: int, decrypt: bool = True) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM accounts WHERE id = ?", (account_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    if decrypt:
        d["password"] = decrypt_password(d.get("password", ""))
        d["pay_password"] = decrypt_password(d.get("pay_password", ""))
    d["withdrawal_amounts"] = _parse_withdrawal_amounts(d.get("withdrawal_amounts"))
    d["withdrawal_fee"] = float(d.get("withdrawal_fee") or 0.0)
    return d


def add_account(phone: str, password: str, label: str = "", max_tasks: int = 0, mode: str = "api", enabled: int = 1,
                auto_withdraw: int = 0, withdraw_amount: float = 0.0, pay_password: str = "", withdraw_wallet: int = 2) -> Dict[str, Any]:
    clean_phone = normalize_phone(phone)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    enc_pwd = encrypt_password(password)
    enc_pay_pwd = encrypt_password(pay_password.strip()) if pay_password and pay_password.strip() else ""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO accounts (phone, password, label, max_tasks, mode, enabled, auto_withdraw, withdraw_amount, pay_password, withdraw_wallet, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (clean_phone, enc_pwd, label or f"Account {clean_phone[-4:]}", max_tasks, mode, enabled,
          int(auto_withdraw), float(withdraw_amount), enc_pay_pwd, int(withdraw_wallet), now))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return get_account(new_id, decrypt=False)


def update_account(account_id: int, phone: Optional[str] = None, password: Optional[str] = None,
                   label: Optional[str] = None, max_tasks: Optional[int] = None,
                   mode: Optional[str] = None, enabled: Optional[int] = None,
                   auto_withdraw: Optional[int] = None, withdraw_amount: Optional[float] = None,
                   pay_password: Optional[str] = None, withdraw_wallet: Optional[int] = None) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()

    fields = []
    values = []
    if phone is not None:
        fields.append("phone = ?")
        values.append(normalize_phone(phone))
    if password is not None and password.strip() != "":
        fields.append("password = ?")
        values.append(encrypt_password(password.strip()))
    if label is not None:
        fields.append("label = ?")
        values.append(label)
    if max_tasks is not None:
        fields.append("max_tasks = ?")
        values.append(max_tasks)
    if mode is not None:
        fields.append("mode = ?")
        values.append(mode)
    if enabled is not None:
        fields.append("enabled = ?")
        values.append(enabled)
    if auto_withdraw is not None:
        fields.append("auto_withdraw = ?")
        values.append(int(auto_withdraw))
    if withdraw_amount is not None:
        fields.append("withdraw_amount = ?")
        values.append(float(withdraw_amount))
    if pay_password is not None and pay_password.strip() != "":
        fields.append("pay_password = ?")
        values.append(encrypt_password(pay_password.strip()))
    if withdraw_wallet is not None:
        fields.append("withdraw_wallet = ?")
        values.append(int(withdraw_wallet))

    if fields:
        values.append(account_id)
        sql = f"UPDATE accounts SET {', '.join(fields)} WHERE id = ?"
        cursor.execute(sql, values)
        conn.commit()

    conn.close()
    return get_account(account_id, decrypt=False)


def update_account_withdrawal_status(account_id: int, status: str, withdraw_date: Optional[str] = None):
    """Record the latest withdrawal status and optional execution date."""
    conn = get_connection()
    cursor = conn.cursor()
    if withdraw_date is not None:
        cursor.execute("""
            UPDATE accounts
            SET last_withdraw_status = ?, last_withdraw_date = ?
            WHERE id = ?
        """, (status, withdraw_date, account_id))
    else:
        now_date = datetime.now().strftime("%Y-%m-%d")
        cursor.execute("""
            UPDATE accounts
            SET last_withdraw_status = ?, last_withdraw_date = ?
            WHERE id = ?
        """, (status, now_date, account_id))
    conn.commit()
    conn.close()


def can_withdraw_today(account: Dict[str, Any], enforce_time_window: bool = True) -> Tuple[bool, str]:
    """
    Validates platform rules:
    1. Withdrawal window is strictly 09:00 to 17:00 (9am to 5pm) local time.
    2. Withdrawal can only occur once per calendar day per account.
    """
    now = datetime.now()
    if enforce_time_window:
        if now.weekday() in (5, 6):
            return False, "Withdrawals are only permitted Monday through Friday (Platform closed on weekends)."
        if now.hour < 9 or now.hour >= 17:
            return False, f"Withdrawals only permitted between 09:00 and 17:00 (Current: {now.strftime('%H:%M')})"

    today_str = now.strftime("%Y-%m-%d")
    if account.get("last_withdraw_date") == today_str:
        return False, f"Account already submitted a withdrawal today ({today_str})"

    return True, "OK"


def delete_account(account_id: int) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
    deleted = cursor.rowcount > 0
    cursor.execute("DELETE FROM run_history WHERE account_id = ?", (account_id,))
    conn.commit()
    conn.close()
    return deleted


def record_run_history(account_id: int, phone: str, label: str, status: str, tasks_done: int = 0, earned: float = 0.0, balance: str = "0"):
    """Store audit log entry of an automation execution (#2)."""
    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute("""
        INSERT INTO run_history (account_id, phone, label, run_time, status, tasks_done, earned, balance)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (account_id, phone, label, now, status, tasks_done, earned, str(balance)))
    # Cap history at 500 records
    cursor.execute("DELETE FROM run_history WHERE id NOT IN (SELECT id FROM run_history ORDER BY id DESC LIMIT 500)")
    conn.commit()
    conn.close()


def get_run_history(account_id: Optional[int] = None, limit: int = 50) -> List[Dict[str, Any]]:
    """Retrieve run history for all accounts or a specific account (#2)."""
    conn = get_connection()
    cursor = conn.cursor()
    if account_id:
        cursor.execute("SELECT * FROM run_history WHERE account_id = ? ORDER BY id DESC LIMIT ?", (account_id, limit))
    else:
        cursor.execute("SELECT * FROM run_history ORDER BY id DESC LIMIT ?", (limit,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def update_account_stats(account_id: int, vip_level: Optional[str] = None, balance: Optional[str] = None,
                         income_balance: Optional[float] = None, personal_balance: Optional[float] = None,
                         last_status: Optional[str] = None, tasks_done: int = 0, earned: float = 0.0,
                         lifetime_tasks: Optional[int] = None, lifetime_earned: Optional[float] = None,
                         tasks_done_today: Optional[int] = None, earned_today: Optional[float] = None,
                         withdrawal_amounts: Optional[Any] = None, withdrawal_fee: Optional[float] = None):
    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute("SELECT tasks_done_today, earned_today, total_tasks_done, total_earned_ghs FROM accounts WHERE id = ?", (account_id,))
    current = cursor.fetchone()
    curr_td_today = current["tasks_done_today"] if current and current["tasks_done_today"] is not None else 0
    curr_earned_today = current["earned_today"] if current and current["earned_today"] is not None else 0.0
    curr_total_tasks = current["total_tasks_done"] if current and current["total_tasks_done"] is not None else 0
    curr_total_earned = current["total_earned_ghs"] if current and current["total_earned_ghs"] is not None else 0.0

    new_td_today = curr_td_today + tasks_done
    if tasks_done_today is not None:
        new_td_today = max(new_td_today, int(tasks_done_today))

    new_earned_today = curr_earned_today + earned
    if earned_today is not None:
        new_earned_today = max(new_earned_today, float(earned_today))

    new_total_tasks = curr_total_tasks + tasks_done
    if lifetime_tasks is not None:
        new_total_tasks = max(new_total_tasks, int(lifetime_tasks))

    new_total_earned = curr_total_earned + earned
    if lifetime_earned is not None:
        new_total_earned = max(new_total_earned, float(lifetime_earned))

    # Format withdrawal amounts if provided
    w_amts_str = None
    if withdrawal_amounts is not None:
        if isinstance(withdrawal_amounts, (list, tuple)):
            w_amts_str = "|".join(str(x) for x in withdrawal_amounts)
        elif isinstance(withdrawal_amounts, str):
            w_amts_str = withdrawal_amounts

    cursor.execute("""
        UPDATE accounts SET
            vip_level = COALESCE(?, vip_level),
            balance = COALESCE(?, balance),
            income_balance = COALESCE(?, income_balance),
            personal_balance = COALESCE(?, personal_balance),
            withdrawal_amounts = COALESCE(?, withdrawal_amounts),
            withdrawal_fee = COALESCE(?, withdrawal_fee),
            last_status = ?,
            last_run_time = ?,
            tasks_done_today = ?,
            earned_today = ?,
            total_tasks_done = ?,
            total_earned_ghs = ?
        WHERE id = ?
    """, (vip_level, balance, income_balance, personal_balance, w_amts_str, withdrawal_fee, last_status, now, new_td_today, new_earned_today, new_total_tasks, new_total_earned, account_id))
    conn.commit()

    # Fetch updated account details for run history
    cursor.execute("SELECT phone, label, balance FROM accounts WHERE id = ?", (account_id,))
    acc_row = cursor.fetchone()
    if acc_row and last_status and last_status != "Running...":
        record_run_history(
            account_id=account_id,
            phone=acc_row["phone"],
            label=acc_row["label"] or acc_row["phone"],
            status=last_status,
            tasks_done=tasks_done,
            earned=earned,
            balance=balance or acc_row["balance"] or "0"
        )

    if tasks_done > 0 or earned > 0:
        record_daily_earnings(tasks_done, earned)

    conn.close()


def record_daily_earnings(tasks_done: int, earned: float):
    today = datetime.now().strftime("%Y-%m-%d")
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO daily_records (date, tasks_count, earned_ghs)
        VALUES (?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
            tasks_count = tasks_count + excluded.tasks_count,
            earned_ghs = earned_ghs + excluded.earned_ghs
    """, (today, tasks_done, earned))
    conn.commit()
    conn.close()


def get_last_7_days_analytics() -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    
    # Generate past 7 days list
    today = datetime.now()
    dates = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(6, -1, -1)]
    min_date = dates[0]
    
    # Track earnings and tasks only for active accounts (enabled = 1)
    cursor.execute("""
        SELECT 
            SUBSTR(rh.run_time, 1, 10) as date, 
            SUM(rh.tasks_done) as tasks, 
            SUM(rh.earned) as earned 
        FROM run_history rh 
        JOIN accounts a ON rh.account_id = a.id 
        WHERE a.enabled = 1 AND rh.run_time >= ? 
        GROUP BY SUBSTR(rh.run_time, 1, 10)
    """, (min_date,))
    rows = {row["date"]: {"tasks": row["tasks"] or 0, "earned": row["earned"] or 0.0} for row in cursor.fetchall()}

    # Ensure today's chart point directly reflects active accounts' current earnings
    cursor.execute("""
        SELECT 
            SUM(tasks_done_today) as tasks, 
            SUM(earned_today) as earned 
        FROM accounts 
        WHERE enabled = 1
    """)
    today_active = cursor.fetchone()
    today_str = today.strftime("%Y-%m-%d")
    if today_active:
        today_tasks = today_active["tasks"] or 0
        today_earned = today_active["earned"] or 0.0
        if today_str in rows:
            rows[today_str]["tasks"] = max(rows[today_str]["tasks"], today_tasks)
            rows[today_str]["earned"] = max(rows[today_str]["earned"], today_earned)
        else:
            rows[today_str] = {"tasks": today_tasks, "earned": today_earned}

    conn.close()

    result = []
    for d in dates:
        entry = rows.get(d, {"tasks": 0, "earned": 0.0})
        day_label = datetime.strptime(d, "%Y-%m-%d").strftime("%a (%d)")
        result.append({
            "date": d,
            "label": day_label,
            "tasks": entry["tasks"],
            "earned": round(entry["earned"], 2)
        })
    return result


def get_dashboard_stats() -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            COUNT(*) as total, 
            SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active, 
            SUM(CASE WHEN enabled = 1 THEN tasks_done_today ELSE 0 END) as tasks, 
            SUM(CASE WHEN enabled = 1 THEN earned_today ELSE 0 END) as earned,
            SUM(CASE WHEN enabled = 1 THEN total_tasks_done ELSE 0 END) as lifetime_tasks,
            SUM(CASE WHEN enabled = 1 THEN total_earned_ghs ELSE 0 END) as lifetime_earned
        FROM accounts
    """)
    row = cursor.fetchone()
    conn.close()

    total = row["total"] or 0
    active = row["active"] or 0
    tasks = row["tasks"] or 0
    earned = row["earned"] or 0.0
    lifetime_tasks = row["lifetime_tasks"] or 0
    lifetime_earned = row["lifetime_earned"] or 0.0
    return {
        "total_accounts": total,
        "active_accounts": active,
        "tasks_completed_today": tasks,
        "total_earned_today": round(earned, 2),
        "lifetime_tasks": lifetime_tasks,
        "lifetime_earned": round(lifetime_earned, 2)
    }


def get_setting(key: str, default: str = "") -> str:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    return row["value"] if row else default


def set_setting(key: str, value: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))
    conn.commit()
    conn.close()


def get_dashboard_password() -> str:
    pwd = get_setting("dashboard_password", "")
    if not pwd:
        pwd = os.getenv("DASHBOARD_PASSWORD", "admin123")
    return pwd.strip()


def verify_dashboard_password(candidate: str) -> bool:
    expected = get_dashboard_password()
    return bool(candidate and candidate.strip() == expected)


# ==============================================================================
# Intelligent Randomized Withdrawal Queue & Anti-Clustering Engine
# ==============================================================================
def calculate_next_withdrawal_slot(conn: Optional[sqlite3.Connection] = None) -> str:
    """
    Calculates the next available withdrawal slot ensuring:
    1. Strictly within Ace775 operating window: 09:00 - 17:00 local time.
    2. Monday - Saturday only (Sundays are skipped as platform rest days).
    3. Randomized spacing between 25 and 50 minutes from the previous scheduled slot.
    4. Random second-level jitter (0 to 59s).
    """
    close_conn = False
    if conn is None:
        conn = get_connection()
        close_conn = True

    try:
        try:
            min_spacing = int(get_setting("min_withdrawal_spacing_minutes", "25") or "25")
        except (ValueError, TypeError):
            min_spacing = 25

        try:
            max_spacing = int(get_setting("max_withdrawal_spacing_minutes", "50") or "50")
        except (ValueError, TypeError):
            max_spacing = 50

        if min_spacing > max_spacing:
            min_spacing, max_spacing = max_spacing, min_spacing

        cursor = conn.cursor()
        # Find the latest scheduled_for among all pending/processing items
        cursor.execute("""
            SELECT scheduled_for FROM withdrawal_queue
            WHERE status IN ('queued', 'processing')
            ORDER BY scheduled_for DESC
            LIMIT 1
        """)
        last_row = cursor.fetchone()
        now = datetime.now()

        def push_to_next_valid_day(dt: datetime) -> datetime:
            """Ensure date is Mon-Fri between 09:10 and 09:35."""
            next_day = dt + timedelta(days=1)
            # If weekend (Saturday 5 or Sunday 6), skip forward to Monday
            while next_day.weekday() in (5, 6):
                next_day += timedelta(days=1)
            start_min = random.randint(10, 35)
            start_sec = random.randint(0, 59)
            return next_day.replace(hour=9, minute=start_min, second=start_sec, microsecond=0)

        if last_row and last_row[0]:
            try:
                last_dt = datetime.strptime(last_row[0], "%Y-%m-%d %H:%M:%S")
            except ValueError:
                last_dt = now

            base_dt = max(now, last_dt)
            # Add randomized spacing interval (e.g. 25 - 50 minutes) + jitter
            step_mins = random.randint(min_spacing, max_spacing)
            step_secs = random.randint(0, 59)
            candidate = base_dt + timedelta(minutes=step_mins, seconds=step_secs)
        else:
            # First item in queue
            if now.hour < 9:
                start_min = random.randint(10, 30)
                start_sec = random.randint(0, 59)
                candidate = now.replace(hour=9, minute=start_min, second=start_sec, microsecond=0)
                if candidate.weekday() in (5, 6):
                    candidate = push_to_next_valid_day(candidate - timedelta(days=1))
            elif now.hour >= 17 or (now.hour == 16 and now.minute >= 45):
                candidate = push_to_next_valid_day(now)
            else:
                # Within daytime window (09:00 - 16:45)
                start_delay = random.randint(3, 10)
                candidate = now + timedelta(minutes=start_delay, seconds=random.randint(0, 59))

        # Check weekend platform closure for withdrawals (Saturday & Sunday)
        if candidate.weekday() in (5, 6):
            candidate = push_to_next_valid_day(candidate)

        # Check operating hours window (09:00 - 17:00, with 16:45 cut-off)
        if candidate.hour < 9:
            candidate = candidate.replace(hour=9, minute=random.randint(10, 30), second=random.randint(0, 59))
        elif candidate.hour >= 17 or (candidate.hour == 16 and candidate.minute >= 45):
            candidate = push_to_next_valid_day(candidate)

        return candidate.strftime("%Y-%m-%d %H:%M:%S")

    finally:
        if close_conn:
            conn.close()


def enqueue_withdrawal(account_id: int, phone: str, label: str, amount: float,
                       wallet_flag: int = 2, pay_password: str = "") -> Dict[str, Any]:
    """
    Places an auto-withdrawal request in the queue with randomized anti-clustering spacing.
    Enforces 1 pending item per account and validates daily withdrawal limit.
    """
    conn = get_connection()
    cursor = conn.cursor()
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        today_str = datetime.now().strftime("%Y-%m-%d")

        # 1. Check if account already has an active queue item
        cursor.execute("""
            SELECT id, scheduled_for, status FROM withdrawal_queue
            WHERE account_id = ? AND status IN ('queued', 'processing')
            LIMIT 1
        """, (account_id,))
        existing = cursor.fetchone()
        if existing:
            return {
                "queued": False,
                "already_queued": True,
                "queue_id": existing["id"],
                "scheduled_for": existing["scheduled_for"],
                "status": existing["status"],
                "message": f"Account already has an active withdrawal in queue scheduled for {existing['scheduled_for']}."
            }

        # 2. Check if account already completed a withdrawal today
        cursor.execute("SELECT last_withdraw_date FROM accounts WHERE id = ?", (account_id,))
        acc_row = cursor.fetchone()
        if acc_row and acc_row["last_withdraw_date"] == today_str:
            return {
                "queued": False,
                "already_queued": False,
                "message": f"Account already completed a withdrawal today ({today_str}). Maximum 1 withdrawal per day allowed."
            }

        # 3. Calculate next randomized slot strictly within 09:00 - 17:00
        slot_time = calculate_next_withdrawal_slot(conn)
        enc_pay_pwd = encrypt_password(pay_password) if pay_password else ""

        cursor.execute("""
            INSERT INTO withdrawal_queue (
                account_id, phone, label, amount, wallet_flag, pay_password, status, queued_at, scheduled_for
            ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
        """, (account_id, phone, label or phone, float(amount), int(wallet_flag), enc_pay_pwd, now_str, slot_time))
        new_id = cursor.lastrowid
        conn.commit()

        # Update account withdrawal status note
        time_display = slot_time[11:16] if len(slot_time) >= 16 else slot_time
        update_account_withdrawal_status(account_id, status=f"Queued: {amount:.2f} GHS for {time_display}")

        return {
            "queued": True,
            "already_queued": False,
            "queue_id": new_id,
            "amount": float(amount),
            "scheduled_for": slot_time,
            "message": f"Successfully queued {amount:.2f} GHS. Scheduled for {slot_time}."
        }
    finally:
        conn.close()


def get_due_withdrawal() -> Optional[Dict[str, Any]]:
    """Find the next withdrawal ready to execute (now >= scheduled_for, within Mon-Fri 09:00-17:00)."""
    now = datetime.now()
    if now.weekday() in (5, 6):
        return None
    if now.hour < 9 or now.hour >= 17:
        return None

    now_str = now.strftime("%Y-%m-%d %H:%M:%S")
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM withdrawal_queue
        WHERE status = 'queued' AND scheduled_for <= ?
        ORDER BY scheduled_for ASC
        LIMIT 1
    """, (now_str,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    d["pay_password"] = decrypt_password(d.get("pay_password", ""))
    return d


def cancel_queued_withdrawal(queue_id: int) -> bool:
    """Allows cancelling a queued withdrawal before it executes."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT account_id FROM withdrawal_queue WHERE id = ? AND status = 'queued'", (queue_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return False

    acc_id = row["account_id"]
    cursor.execute("""
        UPDATE withdrawal_queue
        SET status = 'cancelled', result_message = 'Cancelled by operator'
        WHERE id = ? AND status = 'queued'
    """, (queue_id,))
    ok = cursor.rowcount > 0
    conn.commit()
    conn.close()

    if ok:
        update_account_withdrawal_status(acc_id, status="Queue Cancelled")
    return ok


def update_queue_item_status(queue_id: int, status: str, result_message: str = ""):
    """Update execution state of a withdrawal queue record."""
    conn = get_connection()
    cursor = conn.cursor()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute("""
        UPDATE withdrawal_queue
        SET status = ?, result_message = ?, executed_at = ?
        WHERE id = ?
    """, (status, result_message, now_str if status in ('completed', 'failed') else '', queue_id))
    conn.commit()
    conn.close()


def get_withdrawal_queue(limit: int = 50) -> List[Dict[str, Any]]:
    """Returns withdrawal queue list for web dashboard with masked passwords."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM withdrawal_queue
        ORDER BY
            CASE status
                WHEN 'processing' THEN 1
                WHEN 'queued' THEN 2
                ELSE 3
            END,
            scheduled_for ASC,
            id DESC
        LIMIT ?
    """, (limit,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    for r in rows:
        r["pay_password"] = "••••••" if r.get("pay_password") else ""
    return rows


init_db()
