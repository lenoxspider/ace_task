/**
 * Ace775 Web Dashboard Frontend Logic (Vanilla JS)
 * Includes Smart Scheduler, Analytics Chart, and SSE Streaming
 */

let accounts = [];
let eventSource = null;

document.addEventListener("DOMContentLoaded", () => {
  loadStats();
  loadAccounts();
  loadAnalytics();
  loadSchedulerStatus();
  initLogStream();
  loadSettings();

  // Periodic polling every 12 seconds
  setInterval(() => {
    loadStats();
    loadSchedulerStatus();
    loadAnalytics();
  }, 12000);
});

// ==============================================================================
// Accounts Management
// ==============================================================================
async function loadAccounts() {
  try {
    const res = await fetch("/api/accounts");
    if (!res.ok) throw new Error("Failed to load accounts");
    accounts = await res.json();
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
    const isRunning = acc.last_status === "Running...";
    return `
      <div class="account-card ${acc.enabled ? '' : 'disabled'}" id="card-acc-${acc.id}">
        <div class="acc-info-primary">
          <div class="acc-avatar">${acc.label ? acc.label.charAt(0).toUpperCase() : 'A'}</div>
          <div class="acc-details">
            <div class="acc-label-row">
              <span class="acc-label">${escapeHtml(acc.label || 'Account')}</span>
              <span class="badge badge-vip">${escapeHtml(acc.vip_level || 'VIP')}</span>
              <span class="badge badge-mode">${escapeHtml(acc.mode.toUpperCase())}</span>
            </div>
            <span class="acc-phone">+233 ${escapeHtml(acc.phone)}</span>
          </div>
        </div>

        <div class="acc-stats-group">
          <div class="acc-stat-box">
            <span class="acc-stat-label">Balance</span>
            <span class="acc-stat-val">${acc.balance || '0'} <small style="color:var(--accent-cyan)">GHS</small></span>
          </div>
          <div class="acc-stat-box">
            <span class="acc-stat-label">Status</span>
            <span class="acc-stat-val" style="font-size:0.8rem; color:${acc.last_status && acc.last_status.includes('Completed') ? 'var(--success)' : 'var(--text-muted)'}">
              ${escapeHtml(acc.last_status || 'Never run')}
            </span>
          </div>
        </div>

        <div class="acc-actions">
          <button class="btn-run" onclick="runAccount(${acc.id})" ${isRunning ? 'disabled' : ''}>
            ${isRunning ? '⏳ Running...' : '▶ Run'}
          </button>
          <button class="btn-icon-action" title="Edit Account" onclick="editAccount(${acc.id})">✏️</button>
          <button class="btn-icon-action btn-delete" title="Delete Account" onclick="deleteAccount(${acc.id})">🗑️</button>
        </div>
      </div>
    `;
  }).join("");
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

async function handleAccountSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("form-account-id").value;
  const payload = {
    phone: document.getElementById("form-phone").value.trim(),
    password: document.getElementById("form-password").value.trim(),
    label: document.getElementById("form-label").value.trim(),
    mode: document.getElementById("form-mode").value,
    max_tasks: parseInt(document.getElementById("form-max-tasks").value, 10) || 0,
    enabled: document.getElementById("form-enabled").checked ? 1 : 0
  };

  try {
    const url = id ? `/api/accounts/${id}` : "/api/accounts";
    const method = id ? "PUT" : "POST";
    const res = await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Save failed");
    }

    closeAccountModal();
    loadAccounts();
    loadStats();
  } catch (err) {
    alert("Error: " + err.message);
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
  } catch (err) {
    console.error("Stats load error:", err);
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
// Terminal Console & SSE Log Streaming
// ==============================================================================
function initLogStream() {
  if (eventSource) eventSource.close();

  eventSource = new EventSource("/api/logs/stream");

  eventSource.onmessage = (event) => {
    if (event.data && !event.data.includes("ping")) {
      const line = event.data;
      let level = "info";
      if (line.includes("[SUCCESS]") || line.includes("✅") || line.includes("🎉")) level = "success";
      else if (line.includes("[WARNING]") || line.includes("⚠️") || line.includes("⏳")) level = "warning";
      else if (line.includes("[ERROR]") || line.includes("❌")) level = "error";

      appendTerminalLog(line, level);
      loadStats();
      loadAccounts();
      loadAnalytics();
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
