"""
Database management module for Ace775 Multi-Account Bot.
Stores accounts, settings, run statistics, and 7-day analytics in SQLite.
"""

import os
import sqlite3
import base64
import hashlib
from typing import List, Dict, Any, Optional
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

    # Migration: ensure lifetime columns exist for existing databases
    cursor.execute("PRAGMA table_info(accounts)")
    columns = [col["name"] for col in cursor.fetchall()]
    if "total_tasks_done" not in columns:
        cursor.execute("ALTER TABLE accounts ADD COLUMN total_tasks_done INTEGER DEFAULT 0")
    if "total_earned_ghs" not in columns:
        cursor.execute("ALTER TABLE accounts ADD COLUMN total_earned_ghs REAL DEFAULT 0.0")

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
    conn.commit()

    # Seed initial settings
    defaults = {
        "schedule_time": "09:00",
        "schedule_time_2": "",
        "schedule_enabled": "1",
        "auto_retry_outside_hours": "1",
        "retry_interval_minutes": "30",
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


def get_accounts(mask_passwords: bool = True) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM accounts ORDER BY id ASC")
    rows = []
    for r in cursor.fetchall():
        d = dict(r)
        if mask_passwords:
            d["password"] = "••••••••"
        else:
            d["password"] = decrypt_password(d.get("password", ""))
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
    return d


def add_account(phone: str, password: str, label: str = "", max_tasks: int = 0, mode: str = "api", enabled: int = 1) -> Dict[str, Any]:
    clean_phone = normalize_phone(phone)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    enc_pwd = encrypt_password(password)
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO accounts (phone, password, label, max_tasks, mode, enabled, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (clean_phone, enc_pwd, label or f"Account {clean_phone[-4:]}", max_tasks, mode, enabled, now))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return get_account(new_id, decrypt=False)


def update_account(account_id: int, phone: Optional[str] = None, password: Optional[str] = None,
                   label: Optional[str] = None, max_tasks: Optional[int] = None,
                   mode: Optional[str] = None, enabled: Optional[int] = None) -> Optional[Dict[str, Any]]:
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

    if fields:
        values.append(account_id)
        sql = f"UPDATE accounts SET {', '.join(fields)} WHERE id = ?"
        cursor.execute(sql, values)
        conn.commit()

    conn.close()
    return get_account(account_id, decrypt=False)


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
                         last_status: Optional[str] = None, tasks_done: int = 0, earned: float = 0.0):
    conn = get_connection()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute("""
        UPDATE accounts SET
            vip_level = COALESCE(?, vip_level),
            balance = COALESCE(?, balance),
            last_status = ?,
            last_run_time = ?,
            tasks_done_today = tasks_done_today + ?,
            earned_today = earned_today + ?,
            total_tasks_done = total_tasks_done + ?,
            total_earned_ghs = total_earned_ghs + ?
        WHERE id = ?
    """, (vip_level, balance, last_status, now, tasks_done, earned, tasks_done, earned, account_id))
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
    
    cursor.execute("SELECT date, tasks_count, earned_ghs FROM daily_records WHERE date >= ?", (dates[0],))
    rows = {row["date"]: {"tasks": row["tasks_count"], "earned": row["earned_ghs"]} for row in cursor.fetchall()}
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
            SUM(enabled) as active, 
            SUM(tasks_done_today) as tasks, 
            SUM(earned_today) as earned,
            SUM(total_tasks_done) as lifetime_tasks,
            SUM(total_earned_ghs) as lifetime_earned
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


init_db()
