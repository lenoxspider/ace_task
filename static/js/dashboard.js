/**
 * Ace775 Web Dashboard Frontend Logic (Vanilla JS)
 * Includes Smart Scheduler, Analytics Chart, Live Running Badges, Lifetime Stats, and SSE Streaming
 */

// Automatically redirect to /login on session expiry
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const response = await originalFetch(...args);
  if (response.status === 401 && !window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
  return response;
};

let accounts = [];
let eventSource = null;
let runningAccountIds = new Set();

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  loadStats();
  loadAccounts();
  loadAnalytics();
  loadSchedulerStatus();
  checkActiveRuns();
  initLogStream();
  loadSettings();

  // Periodic polling every 10 seconds
  setInterval(() => {
    loadStats();
    loadSchedulerStatus();
    checkActiveRuns();
  }, 10000);
});

// ==============================================================================
// Theme Management (Dark / Light Mode)
// ==============================================================================
function initTheme() {
  const saved = localStorage.getItem("ace_theme") || "dark";
  applyTheme(saved);
}

function toggleTheme() {
  const isLight = document.body.classList.contains("light-mode");
  const nextTheme = isLight ? "dark" : "light";
  applyTheme(nextTheme);
}

function applyTheme(theme) {
  const icon = document.getElementById("theme-icon");
  if (theme === "light") {
    document.body.classList.add("light-mode");
    if (icon) icon.innerText = "🌙";
    localStorage.setItem("ace_theme", "light");
  } else {
    document.body.classList.remove("light-mode");
    if (icon) icon.innerText = "☀️";
    localStorage.setItem("ace_theme", "dark");
  }
}

// ==============================================================================
// Mobile Navigation Toggle
// ==============================================================================
function toggleMobileMenu() {
  const menu = document.getElementById("header-actions");
  const btn = document.getElementById("btn-mobile-menu");
  if (menu) menu.classList.toggle("mobile-open");
  if (btn) btn.classList.toggle("active");
}

// Close mobile menu when clicking outside
document.addEventListener("click", (e) => {
  const menu = document.getElementById("header-actions");
  const btn = document.getElementById("btn-mobile-menu");
  if (menu && menu.classList.contains("mobile-open") && !menu.contains(e.target) && !btn.contains(e.target)) {
    menu.classList.remove("mobile-open");
    if (btn) btn.classList.remove("active");
  }
});

// ==============================================================================
// Accounts Management & Live Indicators (#4, #6)
// ==============================================================================
async function loadAccounts() {
  try {
    const res = await fetch("/api/accounts");
    if (!res.ok) throw new Error("Failed to load accounts");
    accounts = await res.json();
    // Sync any that report Running...
    accounts.forEach(a => {
      if (a.last_status === "Running...") {
        runningAccountIds.add(a.id);
      }
    });
    renderAccounts(accounts);
  } catch (err) {
    console.error(err);
    document.getElementById("accounts-list").innerHTML = `<div class="empty-placeholder">Failed to load accounts.</div>`;
  }
}

function renderAccounts(list) {
  const container = document.getElementById("accounts-list");
  document.getElementById("badge-account-count").innerText = list.length;

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-placeholder">
        No accounts configured yet. Click <strong>+ Add Account</strong> to get started!
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(acc => {
    const isRunning = runningAccountIds.has(acc.id) || acc.last_status === "Running...";
    const earnedToday = Number(acc.earned_today || 0).toFixed(2);
    const tasksToday = acc.tasks_done_today || 0;
    const lifetimeEarned = Number(acc.total_earned_ghs || 0).toFixed(2);
    const lifetimeTasks = acc.total_tasks_done || 0;

    return `
      <div class="account-card ${acc.enabled ? '' : 'disabled'} ${isRunning ? 'acc-running' : ''}" id="card-acc-${acc.id}">
        <div class="acc-info-primary">
          <div class="acc-avatar ${isRunning ? 'pulse-avatar' : ''}">${acc.label ? acc.label.charAt(0).toUpperCase() : 'A'}</div>
          <div class="acc-details">
            <div class="acc-label-row">
              <span class="acc-label">${escapeHtml(acc.label || 'Account')}</span>
              <span class="badge badge-vip">${escapeHtml(acc.vip_level || 'VIP')}</span>
              <span class="badge badge-mode">${escapeHtml(acc.mode.toUpperCase())}</span>
              <span class="badge badge-running-indicator" style="display: ${isRunning ? 'inline-flex' : 'none'};">
                <span class="spinner-dot"></span> RUNNING NOW
              </span>
            </div>
            <span class="acc-phone">+233 ${escapeHtml(acc.phone)}</span>
            ${acc.auto_withdraw === 1 ? `
              <div class="acc-withdraw-tag ${acc.last_withdraw_date === new Date().toISOString().split('T')[0] ? 'withdrawn-today' : 'withdraw-ready'}">
                💸 Auto: <strong>${acc.withdraw_amount > 0 ? acc.withdraw_amount + ' GHS' : 'Full Bal'}</strong> 
                <span>${acc.last_withdraw_date === new Date().toISOString().split('T')[0] ? '• Done Today' : '• Ready (9am-5pm)'}</span>
              </div>
            ` : ''}
          </div>
        </div>

        <div class="acc-stats-group">
          <div class="acc-stat-box">
            <span class="acc-stat-label">Balance</span>
            <span class="acc-stat-val">${acc.balance || '0'} <small class="currency-tag">GHS</small></span>
          </div>
          <div class="acc-stat-box">
            <span class="acc-stat-label">Today's Profit</span>
            <span class="acc-stat-val text-success">+${earnedToday} <small class="currency-tag">GHS</small></span>
            <span class="acc-stat-sub">${tasksToday} tasks</span>
          </div>
          <div class="acc-stat-box">
            <span class="acc-stat-label">Lifetime Stats</span>
            <span class="acc-stat-val text-cyan">+${lifetimeEarned} <small class="currency-tag">GHS</small></span>
            <span class="acc-stat-sub">${lifetimeTasks} all-time</span>
          </div>
          <div class="acc-stat-box">
            <span class="acc-stat-label">Last Status</span>
            <span class="acc-stat-val acc-status-val" style="color:${getStatusColor(acc.last_status)}">
              ${escapeHtml(acc.last_status || 'Never run')}
            </span>
          </div>
        </div>

        <div class="acc-actions">
          <button class="btn-run ${isRunning ? 'btn-running-active' : ''}" onclick="runAccount(${acc.id})" ${isRunning ? 'disabled' : ''}>
            ${isRunning ? '<span class="spinner-dot"></span> Running...' : '▶ Run'}
          </button>
          <button class="btn-icon-action" id="btn-refresh-${acc.id}" title="Refresh Live Balance" onclick="refreshAccountBalance(${acc.id})">🔄</button>
          <button class="btn-icon-action" title="Request Withdrawal" onclick="openWithdrawModal(${acc.id})">💸</button>
          <button class="btn-icon-action" title="Execution History" onclick="openHistoryModal(${acc.id})">📜</button>
          <button class="btn-icon-action" title="Edit Account" onclick="editAccount(${acc.id})">✏️</button>
          <button class="btn-icon-action btn-delete" title="Delete Account" onclick="deleteAccount(${acc.id})">🗑️</button>
        </div>
      </div>
    `;
  }).join("");
}

function getStatusColor(status) {
  if (!status) return "var(--text-muted)";
  if (status.includes("Completed") || status.includes("Verified")) return "var(--success)";
  if (status.includes("Running")) return "var(--accent-cyan)";
  if (status.includes("Failed") || status.includes("Error")) return "var(--danger)";
  return "var(--text-muted)";
}

function updateRunningVisuals() {
  accounts.forEach(acc => {
    const card = document.getElementById(`card-acc-${acc.id}`);
    if (!card) return;
    const isRunning = runningAccountIds.has(acc.id);
    const runBtn = card.querySelector(".btn-run");
    const indicator = card.querySelector(".badge-running-indicator");
    const avatar = card.querySelector(".acc-avatar");

    if (isRunning) {
      card.classList.add("acc-running");
      if (runBtn) {
        runBtn.disabled = true;
        runBtn.classList.add("btn-running-active");
        runBtn.innerHTML = `<span class="spinner-dot"></span> Running...`;
      }
      if (indicator) indicator.style.display = "inline-flex";
      if (avatar) avatar.classList.add("pulse-avatar");
    } else {
      card.classList.remove("acc-running");
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.classList.remove("btn-running-active");
        runBtn.innerHTML = `▶ Run`;
      }
      if (indicator) indicator.style.display = "none";
      if (avatar) avatar.classList.remove("pulse-avatar");
    }
  });
}

async function checkActiveRuns() {
  try {
    const res = await fetch("/api/run/active");
    if (!res.ok) return;
    const data = await res.json();
    const newRunning = new Set(data.running_ids || []);
    runningAccountIds = newRunning;

    const btnRunAll = document.getElementById("btn-run-all");
    if (data.is_batch_running) {
      if (btnRunAll) {
        btnRunAll.disabled = true;
        btnRunAll.innerHTML = `<span class="spinner-dot"></span> Batch Running...`;
      }
    } else {
      if (btnRunAll) {
        btnRunAll.disabled = false;
        btnRunAll.innerHTML = `<span class="btn-icon">▶</span> Run All Active`;
      }
    }
    updateRunningVisuals();
  } catch (err) {
    console.error("Active runs check error:", err);
  }
}

function filterAccounts() {
  const q = document.getElementById("account-search").value.toLowerCase();
  const filtered = accounts.filter(a => 
    a.phone.toLowerCase().includes(q) || (a.label && a.label.toLowerCase().includes(q))
  );
  renderAccounts(filtered);
}

// ==============================================================================
// Run Actions
// ==============================================================================
async function runAccount(id) {
  try {
    const res = await fetch(`/api/accounts/${id}/run`, { method: "POST" });
    const data = await res.json();
    appendTerminalLog(`[COMMAND] Run triggered for account #${id}`, "info");
    loadAccounts();
  } catch (err) {
    alert("Failed to start run: " + err.message);
  }
}

async function runAllAccounts() {
  const btn = document.getElementById("btn-run-all");
  btn.disabled = true;
  btn.innerHTML = `<span class="btn-icon">⏳</span> Running...`;

  try {
    const res = await fetch("/api/run-all", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      alert(data.message || "Could not start batch run.");
    } else {
      appendTerminalLog("[COMMAND] Batch execution started for all active accounts.", "info");
    }
  } catch (err) {
    alert("Error starting batch run: " + err.message);
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = `<span class="btn-icon">▶</span> Run All Active`;
    }, 2000);
  }
}

// ==============================================================================
// Analytics Chart (7-Day Performance)
// ==============================================================================
async function loadAnalytics() {
  const container = document.getElementById("chart-container");
  try {
    const res = await fetch("/api/analytics/7days");
    if (!res.ok) return;
    const days = await res.json();

    if (!days || days.length === 0) {
      container.innerHTML = `<div class="empty-placeholder">No analytics data recorded yet.</div>`;
      return;
    }

    const maxEarned = Math.max(...days.map(d => d.earned), 10.0);

    container.innerHTML = days.map(d => {
      const heightPercent = Math.max(Math.round((d.earned / maxEarned) * 100), 4);
      return `
        <div class="chart-bar-group" title="${d.date}: ${d.earned} GHS (${d.tasks} tasks)">
          <span class="chart-bar-val">${d.earned > 0 ? '+' + d.earned : '0'}</span>
          <div class="chart-bar-wrapper">
            <div class="chart-bar-fill" style="height: ${heightPercent}%"></div>
          </div>
          <span class="chart-bar-label">${d.label}</span>
        </div>
      `;
    }).join("");

  } catch (err) {
    console.error("Analytics load error:", err);
  }
}

// ==============================================================================
// Scheduler Status
// ==============================================================================
async function loadSchedulerStatus() {
  try {
    const res = await fetch("/api/scheduler");
    if (!res.ok) return;
    const data = await res.json();
    const pill = document.getElementById("header-scheduler-badge");
    const text = document.getElementById("header-scheduler-text");

    if (data.enabled) {
      pill.classList.remove("disabled");
      text.innerText = `Scheduler: ${data.status_text}`;
    } else {
      pill.classList.add("disabled");
      text.innerText = "Scheduler: Disabled";
    }
  } catch (err) {
    console.error("Scheduler status error:", err);
  }
}

// ==============================================================================
// Modals & Forms
// ==============================================================================
function openAccountModal(acc = null) {
  document.getElementById("form-account-id").value = acc ? acc.id : "";
  document.getElementById("form-phone").value = acc ? acc.phone : "";
  document.getElementById("form-password").value = acc ? acc.password : "";
  document.getElementById("form-label").value = acc ? acc.label : "";
  document.getElementById("form-mode").value = acc ? acc.mode : "api";
  document.getElementById("form-max-tasks").value = acc ? acc.max_tasks : 0;
  document.getElementById("form-enabled").checked = acc ? Boolean(acc.enabled) : true;

  // Auto-Withdrawal fields
  const autoW = acc ? Boolean(acc.auto_withdraw) : false;
  document.getElementById("form-auto-withdraw").checked = autoW;
  document.getElementById("form-withdraw-amount").value = acc ? (acc.withdraw_amount || 0) : 0;
  document.getElementById("form-withdraw-wallet").value = acc ? (acc.withdraw_wallet || 2) : 2;
  document.getElementById("form-pay-password").value = acc ? (acc.pay_password || "") : "";
  toggleAutoWithdrawFields();

  // Reset verification banner
  const statusBox = document.getElementById("account-verify-status");
  if (statusBox) {
    statusBox.style.display = "none";
    statusBox.className = "verify-status-banner";
    statusBox.innerHTML = "";
  }
  const saveBtn = document.getElementById("btn-save-account");
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<span class="btn-icon">💾</span> Verify & Save';
  }

  document.getElementById("modal-title").innerText = acc ? "Edit Account" : "Add New Account";
  document.getElementById("account-modal").classList.add("active");
}

function toggleAutoWithdrawFields() {
  const checked = document.getElementById("form-auto-withdraw").checked;
  const box = document.getElementById("auto-withdraw-fields");
  if (box) box.style.display = checked ? "block" : "none";
}

function closeAccountModal() {
  document.getElementById("account-modal").classList.remove("active");
}

function editAccount(id) {
  const acc = accounts.find(a => a.id === id);
  if (acc) openAccountModal(acc);
}

async function testAccountLogins() {
  const phoneInput = document.getElementById("form-phone");
  const pwdInput = document.getElementById("form-password");
  const statusBox = document.getElementById("account-verify-status");
  const testBtn = document.getElementById("btn-test-login");
  const modal = document.querySelector("#account-modal .modal-card");

  const phone = phoneInput.value.trim();
  const password = pwdInput.value.trim();

  if (!phone || !password) {
    statusBox.style.display = "flex";
    statusBox.className = "verify-status-banner verify-error";
    statusBox.innerHTML = "⚠️ Please enter both phone number and password first.";
    return;
  }

  statusBox.style.display = "flex";
  statusBox.className = "verify-status-banner verify-loading";
  statusBox.innerHTML = "⏳ Verifying logins with Ace775 API...";
  testBtn.disabled = true;

  try {
    const res = await fetch("/api/accounts/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password })
    });
    const data = await res.json();
    if (res.ok && data.valid) {
      statusBox.className = "verify-status-banner verify-success";
      statusBox.innerHTML = `✅ <strong>Logins Valid!</strong> VIP: <strong>${escapeHtml(data.vip_level)}</strong> | Balance: <strong>${escapeHtml(data.balance)} GHS</strong>`;
    } else {
      statusBox.className = "verify-status-banner verify-error";
      statusBox.innerHTML = `❌ <strong>Verification Failed:</strong> ${escapeHtml(data.message || data.detail || "Invalid credentials")}`;
      if (modal) {
        modal.classList.add("shake");
        setTimeout(() => modal.classList.remove("shake"), 500);
      }
    }
  } catch (err) {
    statusBox.className = "verify-status-banner verify-error";
    statusBox.innerHTML = `❌ Network error connecting to verification service.`;
  } finally {
    testBtn.disabled = false;
  }
}

async function handleAccountSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("form-account-id").value;
  const saveBtn = document.getElementById("btn-save-account");
  const statusBox = document.getElementById("account-verify-status");
  const modal = document.querySelector("#account-modal .modal-card");

  const phone = document.getElementById("form-phone").value.trim();
  const password = document.getElementById("form-password").value.trim();

  const payload = {
    phone: phone,
    password: password,
    label: document.getElementById("form-label").value.trim(),
    mode: document.getElementById("form-mode").value,
    max_tasks: parseInt(document.getElementById("form-max-tasks").value, 10) || 0,
    enabled: document.getElementById("form-enabled").checked ? 1 : 0,
    auto_withdraw: document.getElementById("form-auto-withdraw").checked ? 1 : 0,
    withdraw_amount: parseFloat(document.getElementById("form-withdraw-amount").value) || 0.0,
    withdraw_wallet: parseInt(document.getElementById("form-withdraw-wallet").value, 10) || 2,
    pay_password: document.getElementById("form-pay-password").value.trim()
  };

  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="btn-icon">⏳</span> Verifying & Saving...';
  statusBox.style.display = "flex";
  statusBox.className = "verify-status-banner verify-loading";
  statusBox.innerHTML = "⏳ Logging into Ace775 to verify credentials...";

  try {
    const url = id ? `/api/accounts/${id}` : "/api/accounts";
    const method = id ? "PUT" : "POST";
    const res = await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Save failed");
    }

    statusBox.className = "verify-status-banner verify-success";
    statusBox.innerHTML = `✅ <strong>Verified & Saved!</strong> Account active.`;

    setTimeout(() => {
      closeAccountModal();
      loadAccounts();
      loadStats();
    }, 600);
  } catch (err) {
    statusBox.className = "verify-status-banner verify-error";
    statusBox.innerHTML = `❌ <strong>Save Rejected:</strong> ${escapeHtml(err.message)}`;
    if (modal) {
      modal.classList.add("shake");
      setTimeout(() => modal.classList.remove("shake"), 500);
    }
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<span class="btn-icon">💾</span> Verify & Save';
  }
}

async function deleteAccount(id) {
  if (!confirm("Are you sure you want to delete this account?")) return;
  try {
    const res = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Delete failed");
    loadAccounts();
    loadStats();
  } catch (err) {
    alert("Error deleting account: " + err.message);
  }
}

// ==============================================================================
// Stats & Settings
// ==============================================================================
async function loadStats() {
  try {
    const res = await fetch("/api/stats");
    if (!res.ok) return;
    const stats = await res.json();
    document.getElementById("stat-total-accounts").innerText = stats.total_accounts;
    document.getElementById("stat-active-subtitle").innerText = `${stats.active_accounts} active in rotation`;
    document.getElementById("stat-tasks-today").innerText = stats.tasks_completed_today;
    document.getElementById("stat-earned-today").innerHTML = `${stats.total_earned_today.toFixed(2)} <span class="currency">GHS</span>`;

    // Lifetime Footers (#6)
    const cards = document.querySelectorAll("#stats-section .stat-card");
    if (cards.length >= 3) {
      if (stats.lifetime_tasks !== undefined) {
        cards[1].querySelector(".stat-footer").innerText = `Today • Lifetime: ${stats.lifetime_tasks} tasks`;
      }
      if (stats.lifetime_earned !== undefined) {
        cards[2].querySelector(".stat-footer").innerText = `Today • Lifetime: ${stats.lifetime_earned.toFixed(2)} GHS`;
      }
    }
  } catch (err) {
    console.error("Stats load error:", err);
  }
}

async function loadSchedulerStatus() {
  try {
    const res = await fetch("/api/scheduler");
    if (!res.ok) return;
    const data = await res.json();
    const textEl = document.getElementById("header-scheduler-text");
    if (textEl) {
      textEl.innerText = "Scheduler: " + (data.status_text || (data.enabled ? "Active" : "Disabled"));
    }
  } catch (err) {
    console.error("Scheduler status error:", err);
  }
}

function openSettingsModal() {
  document.getElementById("settings-modal").classList.add("active");
}

function closeSettingsModal() {
  document.getElementById("settings-modal").classList.remove("active");
}

async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById("set-base-url").value = data.base_url || "https://ace775.com";
    document.getElementById("set-tg-token").value = data.telegram_token || "";
    document.getElementById("set-tg-chat").value = data.telegram_chat_id || "";
    document.getElementById("set-sched-time").value = data.schedule_time || "09:00";
    document.getElementById("set-sched-time-2").value = data.schedule_time_2 || "";
    document.getElementById("set-retry-mins").value = data.retry_interval_minutes || "30";
    document.getElementById("set-sched-enabled").checked = data.schedule_enabled === "1";
    document.getElementById("set-auto-retry").checked = data.auto_retry_outside_hours === "1";
  } catch (err) {
    console.error("Settings error:", err);
  }
}

async function handleSettingsSubmit(e) {
  e.preventDefault();
  const payload = {
    base_url: document.getElementById("set-base-url").value.trim(),
    telegram_token: document.getElementById("set-tg-token").value.trim(),
    telegram_chat_id: document.getElementById("set-tg-chat").value.trim(),
    schedule_time: document.getElementById("set-sched-time").value.trim(),
    schedule_time_2: document.getElementById("set-sched-time-2").value.trim(),
    retry_interval_minutes: document.getElementById("set-retry-mins").value.trim(),
    schedule_enabled: document.getElementById("set-sched-enabled").checked ? "1" : "0",
    auto_retry_outside_hours: document.getElementById("set-auto-retry").checked ? "1" : "0"
  };

  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Failed to save settings");
    closeSettingsModal();
    loadSchedulerStatus();
    appendTerminalLog("[SYSTEM] Settings and Auto-Scheduler updated successfully.", "success");
  } catch (err) {
    alert("Error: " + err.message);
  }
}

// ==============================================================================
// Terminal Console & SSE Log Streaming (#4)
// ==============================================================================
function initLogStream() {
  if (eventSource) eventSource.close();

  eventSource = new EventSource("/api/logs/stream");

  eventSource.onmessage = (event) => {
    if (event.data && !event.data.includes("ping")) {
      const line = event.data;

      // Handle account live indicator signals
      if (line.includes("[ACCOUNT_RUNNING:")) {
        const match = line.match(/\[ACCOUNT_RUNNING:(\d+)\]/);
        if (match) {
          runningAccountIds.add(Number(match[1]));
          updateRunningVisuals();
        }
        return;
      }
      if (line.includes("[ACCOUNT_IDLE:")) {
        const match = line.match(/\[ACCOUNT_IDLE:(\d+)\]/);
        if (match) {
          runningAccountIds.delete(Number(match[1]));
          updateRunningVisuals();
          loadAccounts();
          loadStats();
        }
        return;
      }

      let level = "info";
      if (line.includes("[SUCCESS]") || line.includes("✅") || line.includes("🎉")) level = "success";
      else if (line.includes("[WARNING]") || line.includes("⚠️") || line.includes("⏳")) level = "warning";
      else if (line.includes("[ERROR]") || line.includes("❌")) level = "error";

      appendTerminalLog(line, level);
      loadStats();
      loadSchedulerStatus();
    }
  };

  eventSource.onerror = () => {
    // Reconnection is automatically handled by browser EventSource
  };
}

function appendTerminalLog(text, level = "info") {
  const container = document.getElementById("terminal-logs");
  const el = document.createElement("div");
  el.className = `log-line log-${level}`;
  el.innerText = text;
  container.appendChild(el);

  if (document.getElementById("chk-autoscroll").checked) {
    container.scrollTop = container.scrollHeight;
  }
}

function clearTerminalLogs() {
  document.getElementById("terminal-logs").innerHTML = "";
}

function escapeHtml(str) {
  if (!str) return "";
  return str.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function handleLogout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch (e) {}
  localStorage.removeItem("ace_session_token");
  window.location.href = "/login";
}

// ==============================================================================
// Live Account Balance Refresh (#1)
// ==============================================================================
async function refreshAccountBalance(id) {
  const btn = document.getElementById(`btn-refresh-${id}`);
  if (btn) {
    btn.disabled = true;
    btn.classList.add("spinning");
  }
  appendTerminalLog(`[ACCOUNT] Refreshing live balance for account #${id}...`, "info");
  try {
    const res = await fetch(`/api/accounts/${id}/refresh-balance`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Refresh failed");
    appendTerminalLog(`✅ Refreshed '${data.label || data.phone}': VIP ${data.vip_level} | Balance ${data.balance} GHS`, "success");
    loadAccounts();
    loadStats();
  } catch (err) {
    alert("Refresh Error: " + err.message);
    appendTerminalLog(`❌ Refresh error on account #${id}: ${err.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("spinning");
    }
  }
}

// ==============================================================================
// Execution Run History & Audit Log (#2)
// ==============================================================================
async function openHistoryModal(accountId = null) {
  const modal = document.getElementById("history-modal");
  const tbody = document.getElementById("history-table-body");
  const countBadge = document.getElementById("badge-history-count");
  const title = document.getElementById("history-modal-title");

  modal.classList.add("active");
  tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Loading audit records...</td></tr>`;

  try {
    const url = accountId ? `/api/history?account_id=${accountId}` : `/api/history`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to load history");
    const records = await res.json();
    countBadge.innerText = records.length;

    if (accountId) {
      const acc = accounts.find(a => a.id === accountId);
      title.innerText = acc ? `Audit History: ${acc.label || acc.phone}` : `Audit History: Account #${accountId}`;
    } else {
      title.innerText = "System Execution Audit History";
    }

    if (records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No execution history recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = records.map(r => `
      <tr>
        <td style="font-family:'JetBrains Mono',monospace; font-size:0.8rem; color:var(--text-dim); white-space:nowrap;">${escapeHtml(r.run_time || '')}</td>
        <td><strong>${escapeHtml(r.label || r.phone || 'Account')}</strong><br><small style="color:var(--text-dim)">+233 ${escapeHtml(r.phone || '')}</small></td>
        <td><span class="badge" style="background:${r.status && r.status.includes('Completed') ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}; color:${r.status && r.status.includes('Completed') ? 'var(--success)' : 'var(--danger)'};">${escapeHtml(r.status || 'N/A')}</span></td>
        <td>${r.tasks_done || 0}</td>
        <td style="color:var(--success); font-weight:600;">+${Number(r.earned || 0).toFixed(2)} GHS</td>
        <td style="color:var(--accent-cyan); font-weight:600;">${escapeHtml(r.balance || '0')} GHS</td>
      </tr>
    `).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty" style="color:var(--danger)">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function closeHistoryModal() {
  document.getElementById("history-modal").classList.remove("active");
}

// ==============================================================================
// Batch Account CSV Import (#11)
// ==============================================================================
function openImportModal() {
  document.getElementById("import-modal").classList.add("active");
  document.getElementById("import-status-banner").style.display = "none";
}

function closeImportModal() {
  document.getElementById("import-modal").classList.remove("active");
}

function handleCsvFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById("csv-textarea").value = e.target.result;
  };
  reader.readAsText(file);
}

async function handleCsvImport(e) {
  e.preventDefault();
  const text = document.getElementById("csv-textarea").value.trim();
  const statusBox = document.getElementById("import-status-banner");
  const submitBtn = document.getElementById("btn-submit-import");

  if (!text) {
    alert("Please provide CSV content");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner-dot"></span> Verifying & Importing...';
  statusBox.style.display = "block";
  statusBox.className = "verify-status-banner verify-loading";
  statusBox.innerHTML = "⏳ Logging in and verifying each account against Ace775...";

  try {
    const res = await fetch("/api/accounts/import-csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv_text: text })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Import failed");

    let msg = `✅ Successfully imported <strong>${data.imported}</strong> account(s).`;
    if (data.errors && data.errors.length > 0) {
      msg += `<br><span style="color:var(--danger)">Errors (${data.errors.length}):<br>${data.errors.map(e => escapeHtml(e)).join("<br>")}</span>`;
      statusBox.className = "verify-status-banner verify-warning";
    } else {
      statusBox.className = "verify-status-banner verify-success";
    }
    statusBox.innerHTML = msg;

    loadAccounts();
    loadStats();

    if (data.imported > 0 && (!data.errors || data.errors.length === 0)) {
      setTimeout(() => {
        closeImportModal();
      }, 1500);
    }
  } catch (err) {
    statusBox.className = "verify-status-banner verify-error";
    statusBox.innerHTML = `❌ Import Failed: ${escapeHtml(err.message)}`;
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span class="btn-icon">⚡</span> Verify & Import All';
  }
}

// ==============================================================================
// Inactivity Session Auto-Lock (#14)
// ==============================================================================
let idleTimer = null;
const IDLE_LIMIT_MS = 30 * 60 * 1000; // 30 minutes client-side lock

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    alert("Session locked due to 30 minutes of inactivity for your security.");
    handleLogout();
  }, IDLE_LIMIT_MS);
}

["mousemove", "mousedown", "keypress", "touchstart", "scroll"].forEach(evt => {
  window.addEventListener(evt, resetIdleTimer, { passive: true });
});
resetIdleTimer();

// ==============================================================================
// Manual & On-Demand Withdrawal Handlers
// ==============================================================================
function openWithdrawModal(id) {
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  document.getElementById("withdraw-acc-id").value = acc.id;
  document.getElementById("withdraw-account-label").innerText = `${acc.label || acc.phone} (+233 ${acc.phone})`;
  document.getElementById("withdraw-account-balance").innerText = `${acc.balance || '0.00'} GHS`;
  const defaultAmt = acc.withdraw_amount > 0 ? acc.withdraw_amount : (parseFloat(acc.balance) || 10);
  document.getElementById("withdraw-modal-amount").value = defaultAmt;
  document.getElementById("withdraw-modal-wallet").value = acc.withdraw_wallet || 2;
  document.getElementById("withdraw-modal-pin").value = "";

  const statusBox = document.getElementById("withdraw-status-banner");
  if (statusBox) {
    statusBox.style.display = "none";
    statusBox.className = "verify-status-banner";
    statusBox.innerHTML = "";
  }
  document.getElementById("withdraw-modal").classList.add("active");
}

function closeWithdrawModal() {
  document.getElementById("withdraw-modal").classList.remove("active");
}

async function handleManualWithdrawSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("withdraw-acc-id").value;
  const amount = parseFloat(document.getElementById("withdraw-modal-amount").value);
  const wallet = parseInt(document.getElementById("withdraw-modal-wallet").value, 10) || 2;
  const pin = document.getElementById("withdraw-modal-pin").value.trim();
  const statusBox = document.getElementById("withdraw-status-banner");
  const submitBtn = document.getElementById("btn-submit-withdraw");

  if (!amount || amount <= 0) {
    alert("Please enter a valid withdrawal amount.");
    return;
  }
  if (!pin) {
    alert("Please enter your transaction payment PIN / password.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner-dot"></span> Submitting to Ace775...';
  statusBox.style.display = "block";
  statusBox.className = "verify-status-banner verify-loading";
  statusBox.innerHTML = "⏳ Submitting withdrawal request to Ace775 platform...";

  try {
    const res = await fetch(`/api/accounts/${id}/withdraw-now`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amount,
        pay_password: pin,
        withdraw_wallet: wallet
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Withdrawal failed");

    statusBox.className = "verify-status-banner verify-success";
    statusBox.innerHTML = `✅ <strong>Withdrawal Submitted!</strong> ${escapeHtml(data.message || "")}`;
    appendTerminalLog(`💸 [WITHDRAWAL] Successfully submitted ${amount} GHS for account #${id}`, "success");
    loadAccounts();
    loadStats();
    setTimeout(() => {
      closeWithdrawModal();
    }, 1600);
  } catch (err) {
    statusBox.className = "verify-status-banner verify-error";
    statusBox.innerHTML = `❌ <strong>Withdrawal Error:</strong> ${escapeHtml(err.message)}`;
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span class="btn-icon">💸</span> Confirm & Submit Withdrawal';
  }
}

