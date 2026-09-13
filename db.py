"""
Database management module for Ace775 Multi-Account Bot.
Stores accounts, settings, and run statistics in SQLite.
"""

import os
import sqlite3
from typing import List, Dict, Any, Optional
from datetime import datetime
from dotenv import load_dotenv

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


def get_connection() -> sqlite3.Connection:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create tables if they do not exist and seed default account if empty."""
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
            created_at TEXT DEFAULT ''
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)
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


def get_accounts() -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM accounts ORDER BY id ASC")
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows


def get_account(account_id: int) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM accounts WHERE id = ?", (account_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def add_account(phone: str, password: str, label: str = "", max_tasks: int = 0, mode: str = "api", enabled: int = 1) -> Dict[str, Any]:
    clean_phone = normalize_phone(phone)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO accounts (phone, password, label, max_tasks, mode, enabled, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (clean_phone, password, label or f"Account {clean_phone[-4:]}", max_tasks, mode, enabled, now))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return get_account(new_id)


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
        values.append(password)
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
    return get_account(account_id)


def delete_account(account_id: int) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted


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
            earned_today = earned_today + ?
        WHERE id = ?
    """, (vip_level, balance, last_status, now, tasks_done, earned, account_id))
    conn.commit()
    conn.close()


def get_dashboard_stats() -> Dict[str, Any]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as total, SUM(enabled) as active, SUM(tasks_done_today) as tasks, SUM(earned_today) as earned FROM accounts")
    row = cursor.fetchone()
    conn.close()

    total = row["total"] or 0
    active = row["active"] or 0
    tasks = row["tasks"] or 0
    earned = row["earned"] or 0.0
    return {
        "total_accounts": total,
        "active_accounts": active,
        "tasks_completed_today": tasks,
        "total_earned_today": round(earned, 2)
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


# Initialize database when module is imported
init_db()
