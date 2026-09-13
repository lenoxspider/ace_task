/**
 * Ace775 Web Dashboard Frontend Logic (Vanilla JS)
 */

let accounts = [];
let eventSource = null;

document.addEventListener("DOMContentLoaded", () => {
  loadStats();
  loadAccounts();
  initLogStream();
  loadSettings();

  // Periodic stats poll every 10 seconds
  setInterval(loadStats, 10000);
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
  } catch (err) {
    console.error("Settings error:", err);
  }
}

async function handleSettingsSubmit(e) {
  e.preventDefault();
  const payload = {
    base_url: document.getElementById("set-base-url").value.trim(),
    telegram_token: document.getElementById("set-tg-token").value.trim(),
    telegram_chat_id: document.getElementById("set-tg-chat").value.trim()
  };

  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Failed to save settings");
    closeSettingsModal();
    appendTerminalLog("[SYSTEM] Settings updated successfully.", "success");
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
      if (line.includes("[SUCCESS]") || line.includes("✅")) level = "success";
      else if (line.includes("[WARNING]") || line.includes("⚠️")) level = "warning";
      else if (line.includes("[ERROR]") || line.includes("❌")) level = "error";

      appendTerminalLog(line, level);
      loadStats();
      loadAccounts();
    }
  };

  eventSource.onerror = () => {
    // Reconnect automatically handled by browser EventSource
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
