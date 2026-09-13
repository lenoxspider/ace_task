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
    enabled: document.getElementById("form-enabled").checked ? 1 : 0
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

