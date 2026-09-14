/**
 * Ace775 Command Center - Account Card Component & Management Module
 */

import { state, setAccounts, isAccountRunning, isAccountPaused, getCounts, getFilteredAccounts } from "./state.js";
import { api } from "./api.js";
import { appendTerminalLog } from "./terminal.js";

export function escapeHtml(str) {
  if (!str) return "";
  return str.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getStatusColor(status) {
  if (!status) return "var(--text-muted)";
  if (status.includes("Paused")) return "var(--warning)";
  if (status.includes("Completed") || status.includes("Verified")) return "var(--success)";
  if (status.includes("Running")) return "var(--accent-cyan)";
  if (status.includes("Failed") || status.includes("Error")) return "var(--danger)";
  return "var(--text-muted)";
}

export function updateFilterTabCounts() {
  const counts = getCounts();
  const elAll = document.getElementById("filter-cnt-all");
  const elActive = document.getElementById("filter-cnt-active");
  const elPaused = document.getElementById("filter-cnt-paused");
  const elRunning = document.getElementById("filter-cnt-running");
  const badgeCount = document.getElementById("badge-account-count");

  if (elAll) elAll.innerText = counts.all;
  if (elActive) elActive.innerText = counts.active;
  if (elPaused) elPaused.innerText = counts.paused;
  if (elRunning) elRunning.innerText = counts.running;
  if (badgeCount) badgeCount.innerText = counts.all;
}

export function renderAccounts() {
  const overviewContainer = document.getElementById("accounts-list");
  const accountsPageContainer = document.getElementById("accounts-page-list");

  if (!overviewContainer && !accountsPageContainer) return;

  updateFilterTabCounts();

  function renderCard(acc) {
    const isRunning = isAccountRunning(acc.id);
    const isPaused = isAccountPaused(acc);
    const earnedToday = Number(acc.earned_today || 0).toFixed(2);
    const tasksToday = acc.tasks_done_today || 0;
    const lifetimeEarned = Number(acc.total_earned_ghs || 0).toFixed(2);
    const lifetimeTasks = acc.total_tasks_done || 0;

    return `
      <div class="account-card ${isPaused ? 'paused-card' : ''} ${isRunning ? 'acc-running' : ''}" id="card-acc-${acc.id}">
        <div class="acc-info-primary">
          <div class="acc-avatar ${isRunning ? 'pulse-avatar' : ''} ${isPaused ? 'avatar-paused' : ''}">
            ${acc.label ? acc.label.charAt(0).toUpperCase() : 'A'}
          </div>
          <div class="acc-details">
            <div class="acc-label-row">
              <span class="acc-label">${escapeHtml(acc.label || 'Account')}</span>
              <span class="badge badge-vip">${escapeHtml(acc.vip_level || 'VIP')}</span>
              <span class="badge badge-mode">${escapeHtml(acc.mode.toUpperCase())}</span>
              ${isPaused 
                ? `<span class="badge badge-paused" title="Task automation is paused for this account">⏸️ PAUSED</span>` 
                : `<span class="badge badge-active" title="Task automation is active">ACTIVE</span>`}
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
          ${isPaused ? `
            <button class="btn-resume-action" onclick="toggleAccountPause(${acc.id})" title="Resume task automation for this account">
              ▶️ Resume
            </button>
          ` : `
            <button class="btn-run ${isRunning ? 'btn-running-active' : ''}" onclick="runAccount(${acc.id})" ${isRunning ? 'disabled' : ''} title="Run tasks for this account">
              ${isRunning ? '<span class="spinner-dot"></span> Running...' : '▶ Run'}
            </button>
            <button class="btn-icon-action btn-pause-toggle" title="Pause bot from completing tasks for this account" onclick="toggleAccountPause(${acc.id})">⏸️</button>
          `}
          <button class="btn-icon-action" id="btn-refresh-${acc.id}" title="Refresh Live Balance" onclick="refreshAccountBalance(${acc.id})">🔄</button>
          <button class="btn-icon-action" title="Request Withdrawal" onclick="openWithdrawModal(${acc.id})">💸</button>
          <button class="btn-icon-action" title="Execution History" onclick="openHistoryModal(${acc.id})">📜</button>
          <button class="btn-icon-action" title="Edit Account" onclick="editAccount(${acc.id})">✏️</button>
          <button class="btn-icon-action btn-delete" title="Delete Account" onclick="deleteAccount(${acc.id})">🗑️</button>
        </div>
      </div>
    `;
  }

  // 1. Overview Page: Only active accounts in rotation
  if (overviewContainer) {
    const activeList = state.accounts.filter(a => a.enabled === 1);
    if (activeList.length === 0) {
      overviewContainer.innerHTML = `
        <div class="empty-placeholder">
          No active accounts in rotation. Unpause or add accounts to start automated tasks.
        </div>
      `;
    } else {
      overviewContainer.innerHTML = activeList.map(renderCard).join("");
    }
  }

  // 2. Accounts Management Page: Full list with tab & search filter
  if (accountsPageContainer) {
    const list = getFilteredAccounts();
    if (list.length === 0) {
      const isFiltered = state.searchQuery || state.activeFilter !== "all";
      accountsPageContainer.innerHTML = `
        <div class="empty-placeholder">
          ${isFiltered ? "No accounts match the current filter or search criteria." : "No accounts configured yet. Click '+ Add Account' to get started."}
        </div>
      `;
    } else {
      accountsPageContainer.innerHTML = list.map(renderCard).join("");
    }
  }
}

export async function loadAccounts() {
  try {
    const data = await api.getAccounts();
    setAccounts(data);
    renderAccounts();
  } catch (err) {
    console.error("Failed to load accounts:", err);
  }
}

export async function toggleAccountPause(accountId) {
  try {
    const data = await api.togglePause(accountId);
    const isPaused = data.is_paused;
    const label = data.account?.label || `Account #${accountId}`;
    appendTerminalLog(`[COMMAND] ${isPaused ? '⏸️ Paused' : '▶️ Resumed'} tasks for ${label}`, isPaused ? "warning" : "success");
    await loadAccounts();
    if (window.loadStats) window.loadStats();
  } catch (err) {
    alert(err.message);
  }
}

export async function runAccount(accountId) {
  try {
    await api.runAccount(accountId);
    appendTerminalLog(`[COMMAND] Run triggered for account #${accountId}`, "info");
    await loadAccounts();
  } catch (err) {
    alert(err.message);
    appendTerminalLog(`⚠️ Cannot run account #${accountId}: ${err.message}`, "warning");
  }
}

export async function runAllAccounts() {
  const btn = document.getElementById("btn-run-all");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-icon">⏳</span> Running...`;
  }

  try {
    await api.runAll();
    appendTerminalLog("[COMMAND] Batch execution started for all active accounts.", "info");
  } catch (err) {
    alert(err.message);
  } finally {
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span class="btn-icon">▶</span> Run All Active`;
      }
    }, 2000);
  }
}

export async function refreshAccountBalance(accountId) {
  const btn = document.getElementById(`btn-refresh-${accountId}`);
  if (btn) {
    btn.disabled = true;
    btn.classList.add("spinning");
  }
  appendTerminalLog(`[ACCOUNT] Refreshing live balance for account #${accountId}...`, "info");
  try {
    const data = await api.refreshBalance(accountId);
    const ltInfo = data.total_tasks_done ? ` | Lifetime: ${data.total_tasks_done} tasks (+${Number(data.total_earned_ghs || 0).toFixed(2)} GHS)` : "";
    appendTerminalLog(`✅ Refreshed '${data.label || data.phone}': VIP ${data.vip_level} | Balance ${data.balance} GHS${ltInfo}`, "success");
    await loadAccounts();
    if (window.loadStats) window.loadStats();
  } catch (err) {
    alert("Refresh Error: " + err.message);
    appendTerminalLog(`❌ Refresh error on account #${accountId}: ${err.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("spinning");
    }
  }
}

export async function deleteAccount(accountId) {
  if (!confirm("Are you sure you want to delete this account?")) return;
  try {
    await api.deleteAccount(accountId);
    appendTerminalLog(`[ACCOUNT] Deleted account #${accountId}`, "warning");
    await loadAccounts();
    if (window.loadStats) window.loadStats();
  } catch (err) {
    alert("Error deleting account: " + err.message);
  }
}

export function filterAccounts() {
  const searchInput = document.getElementById("account-search");
  state.searchQuery = searchInput ? searchInput.value : "";
  renderAccounts();
}

export function setAccountFilter(filterName) {
  state.activeFilter = filterName;
  document.querySelectorAll(".filter-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.filter === filterName);
  });
  renderAccounts();
}

export function updateRunningVisuals() {
  renderAccounts();
}
