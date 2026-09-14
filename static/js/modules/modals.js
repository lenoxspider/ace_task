/**
 * Ace775 Command Center - Modals & Dialog Controllers Module
 */

import { api } from "./api.js";
import { state, getAccountById } from "./state.js";
import { loadAccounts, escapeHtml } from "./accounts.js";
import { loadStats } from "./stats.js";
import { loadSchedulerStatus } from "./scheduler.js";
import { appendTerminalLog } from "./terminal.js";

/* ==============================================================================
   1. Account Add / Edit Modal
   ============================================================================== */
export function openAccountModal(acc = null) {
  document.getElementById("form-account-id").value = acc ? acc.id : "";
  document.getElementById("form-phone").value = acc ? acc.phone : "";
  document.getElementById("form-password").value = "";
  document.getElementById("form-password").placeholder = acc ? "•••••••• (Leave blank to keep current)" : "Ace775 account password";
  document.getElementById("form-label").value = acc ? acc.label : "";
  document.getElementById("form-mode").value = acc ? acc.mode : "api";
  document.getElementById("form-max-tasks").value = acc ? acc.max_tasks : 0;
  document.getElementById("form-enabled").checked = acc ? (acc.enabled === 1) : true;

  // Auto-Withdrawal fields
  const autoW = acc ? Boolean(acc.auto_withdraw) : false;
  document.getElementById("form-auto-withdraw").checked = autoW;
  const wAmt = acc ? (acc.withdraw_amount || 0) : 0;

  const allowedTiers = acc && acc.withdrawal_amounts && acc.withdrawal_amounts.length > 0
    ? acc.withdrawal_amounts
    : DEFAULT_PLATFORM_DENOMINATIONS;

  renderDynamicAmountGrid({
    selectId: "form-withdraw-amount",
    gridId: "form-withdraw-pills-grid",
    amounts: allowedTiers,
    selectedAmount: wAmt,
    includeAutoMax: true,
    onClickFnName: "selectFormWithdrawAmount"
  });

  document.getElementById("form-withdraw-wallet").value = acc ? (acc.withdraw_wallet || 2) : 2;
  document.getElementById("form-pay-password").value = "";
  document.getElementById("form-pay-password").placeholder = acc && acc.pay_password ? "•••••• (Leave blank to keep current)" : "6-digit payment password (optional)";
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

export function editAccount(accountId) {
  const acc = getAccountById(accountId);
  if (acc) {
    openAccountModal(acc);
  }
}

export function closeAccountModal() {
  document.getElementById("account-modal").classList.remove("active");
}

export function toggleAutoWithdrawFields() {
  const checked = document.getElementById("form-auto-withdraw").checked;
  const box = document.getElementById("auto-withdraw-fields");
  if (box) box.style.display = checked ? "block" : "none";
}

export async function testAccountLogins() {
  const phone = document.getElementById("form-phone").value.trim();
  const password = document.getElementById("form-password").value.trim();
  const id = document.getElementById("form-account-id").value;
  const statusBox = document.getElementById("account-verify-status");
  const testBtn = document.getElementById("btn-test-login");

  if (!phone) {
    statusBox.style.display = "flex";
    statusBox.className = "verify-status-banner verify-error";
    statusBox.innerHTML = "⚠️ Please enter a phone number first.";
    return;
  }
  if (!id && !password) {
    statusBox.style.display = "flex";
    statusBox.className = "verify-status-banner verify-error";
    statusBox.innerHTML = "⚠️ Please enter the password to test.";
    return;
  }

  testBtn.disabled = true;
  testBtn.innerHTML = '<span class="btn-icon">⏳</span> Testing...';
  statusBox.style.display = "flex";
  statusBox.className = "verify-status-banner verify-loading";
  statusBox.innerHTML = "⏳ Connecting to Ace775 to verify credentials & fetch level tiers...";

  try {
    const data = await api.verifyLogin({
      phone: phone,
      password: password,
      account_id: id ? parseInt(id, 10) : null
    });

    if (data.withdrawal_amounts && data.withdrawal_amounts.length > 0) {
      renderDynamicAmountGrid({
        selectId: "form-withdraw-amount",
        gridId: "form-withdraw-pills-grid",
        amounts: data.withdrawal_amounts,
        selectedAmount: document.getElementById("form-withdraw-amount").value || 0,
        includeAutoMax: true,
        onClickFnName: "selectFormWithdrawAmount"
      });
    }

    statusBox.className = "verify-status-banner verify-success";
    statusBox.innerHTML = `✅ <strong>Login Success!</strong> VIP Level: ${escapeHtml(data.vip_level || 'VIP')} | Income: ${Number(data.income_balance || 0).toFixed(2)} GHS | Fee: ${data.withdrawal_fee || 0}% (${(data.withdrawal_amounts || []).length} tiers loaded)`;
  } catch (err) {
    statusBox.className = "verify-status-banner verify-error";
    statusBox.innerHTML = `❌ <strong>Verification Failed:</strong> ${escapeHtml(err.message)}`;
  } finally {
    testBtn.disabled = false;
    testBtn.innerHTML = '<span class="btn-icon">🔍</span> Test Logins';
  }
}

export async function handleAccountSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("form-account-id").value;
  const saveBtn = document.getElementById("btn-save-account");
  const statusBox = document.getElementById("account-verify-status");

  const phone = document.getElementById("form-phone").value.trim();
  const password = document.getElementById("form-password").value.trim();
  const payPassword = document.getElementById("form-pay-password").value.trim();

  if (!phone) {
    statusBox.style.display = "flex";
    statusBox.className = "verify-status-banner verify-error";
    statusBox.innerHTML = "⚠️ Please enter a phone number.";
    return;
  }
  if (!id && !password) {
    statusBox.style.display = "flex";
    statusBox.className = "verify-status-banner verify-error";
    statusBox.innerHTML = "⚠️ Please enter a password.";
    return;
  }

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
    pay_password: payPassword
  };

  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="btn-icon">⏳</span> Verifying & Saving...';
  statusBox.style.display = "flex";
  statusBox.className = "verify-status-banner verify-loading";
  statusBox.innerHTML = "⏳ Logging into Ace775 to verify credentials...";

  try {
    await api.saveAccount(id, payload);
    statusBox.className = "verify-status-banner verify-success";
    statusBox.innerHTML = `✅ <strong>Verified & Saved!</strong> Account configured.`;

    setTimeout(() => {
      closeAccountModal();
      loadAccounts();
      loadStats();
    }, 600);
  } catch (err) {
    statusBox.className = "verify-status-banner verify-error";
    statusBox.innerHTML = `❌ <strong>Save Rejected:</strong> ${escapeHtml(err.message)}`;
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<span class="btn-icon">💾</span> Verify & Save';
  }
}

/* ==============================================================================
   2. Dynamic Amount Denominations & Selection Helpers
   ============================================================================== */
export const DEFAULT_PLATFORM_DENOMINATIONS = [65, 170, 525, 1600, 4500, 14000, 33500, 65000, 150000, 200000, 500000, 1000000];

export function renderDynamicAmountGrid({
  selectId,
  gridId,
  amounts = DEFAULT_PLATFORM_DENOMINATIONS,
  selectedAmount = 0,
  includeAutoMax = true,
  onClickFnName = "selectWithdrawPageAmount"
}) {
  const select = document.getElementById(selectId);
  const grid = document.getElementById(gridId);

  const raw = (amounts && amounts.length > 0 ? amounts : DEFAULT_PLATFORM_DENOMINATIONS);
  const numAmounts = [...new Set(raw.map(Number))].filter(n => !isNaN(n) && n > 0).sort((a, b) => a - b);

  if (select) {
    let optionsHtml = "";
    if (includeAutoMax) {
      optionsHtml += `<option value="0">Full Balance / Auto-Max Allowed (Default)</option>`;
    }
    numAmounts.forEach(amt => {
      optionsHtml += `<option value="${amt}">${amt.toLocaleString()} GHS</option>`;
    });
    select.innerHTML = optionsHtml;
    select.value = String(selectedAmount);
  }

  if (grid) {
    let pillsHtml = "";
    if (includeAutoMax) {
      const isActive = Number(selectedAmount) === 0;
      pillsHtml += `<button type="button" class="amount-pill ${isActive ? 'active' : ''}" onclick="${onClickFnName}(0)">Full Bal</button>`;
    }
    numAmounts.forEach(amt => {
      const isActive = Number(selectedAmount) === amt;
      pillsHtml += `<button type="button" class="amount-pill ${isActive ? 'active' : ''}" onclick="${onClickFnName}(${amt})">${amt.toLocaleString()}</button>`;
    });
    grid.innerHTML = pillsHtml;
  }
}

export function selectWithdrawAmount(amount) {
  const select = document.getElementById("withdraw-modal-amount");
  if (select) {
    select.value = String(amount);
  }
  syncWithdrawPills(amount);
}

export function syncWithdrawPills(amount) {
  const grid = document.getElementById("withdraw-pills-grid");
  if (!grid) return;
  const pills = grid.querySelectorAll(".amount-pill");
  const targetStr = String(amount);
  pills.forEach(pill => {
    const rawVal = pill.innerText.replace(/,/g, "").trim();
    if (rawVal === targetStr || (Number(amount) === 0 && rawVal === "Full Bal")) {
      pill.classList.add("active");
    } else {
      pill.classList.remove("active");
    }
  });
}

export function selectFormWithdrawAmount(amount) {
  const select = document.getElementById("form-withdraw-amount");
  if (select) {
    select.value = String(amount);
  }
  syncFormWithdrawPills(amount);
}

export function syncFormWithdrawPills(amount) {
  const grid = document.getElementById("form-withdraw-pills-grid");
  if (!grid) return;
  const pills = grid.querySelectorAll(".amount-pill");
  const targetStr = String(amount);
  pills.forEach(pill => {
    const rawVal = pill.innerText.replace(/,/g, "").trim();
    if (rawVal === targetStr || (Number(amount) === 0 && rawVal === "Full Bal")) {
      pill.classList.add("active");
    } else {
      pill.classList.remove("active");
    }
  });
}

export function selectWithdrawPageAmount(amount) {
  const select = document.getElementById("withdraw-page-fixed-amount");
  if (select) {
    select.value = String(amount);
  }
  syncWithdrawPagePills(amount);
}

export function syncWithdrawPagePills(amount) {
  const grid = document.getElementById("withdraw-page-pills-grid");
  if (!grid) return;
  const pills = grid.querySelectorAll(".amount-pill");
  const targetStr = String(amount);
  pills.forEach(pill => {
    const rawVal = pill.innerText.replace(/,/g, "").trim();
    if (rawVal === targetStr || (Number(amount) === 0 && rawVal === "Full Bal")) {
      pill.classList.add("active");
    } else {
      pill.classList.remove("active");
    }
  });
}

/* ==============================================================================
   3. Manual Withdrawal Modal
   ============================================================================== */
export function openWithdrawModal(accountId = null) {
  if (!accountId && state.accounts && state.accounts.length > 0) {
    accountId = state.accounts[0].id;
  }
  const acc = accountId ? getAccountById(accountId) : null;
  if (!acc) {
    alert("Please select or add an account first before requesting a withdrawal.");
    return;
  }

  document.getElementById("withdraw-acc-id").value = acc.id;
  document.getElementById("withdraw-account-label").innerText = `${acc.label || 'Account'} (+233 ${acc.phone})`;
  const incBal = acc.income_balance ? parseFloat(acc.income_balance) : parseFloat(acc.balance || 0);
  const feeInfo = acc.withdrawal_fee ? ` • Fee: ${acc.withdrawal_fee}%` : "";
  document.getElementById("withdraw-account-balance").innerText = `${incBal.toFixed(2)} GHS (Income Wallet - ${acc.vip_level || 'VIP'}${feeInfo})`;

  const allowedDenominations = (acc.withdrawal_amounts && acc.withdrawal_amounts.length > 0)
    ? acc.withdrawal_amounts
    : DEFAULT_PLATFORM_DENOMINATIONS;

  let defaultAmount = allowedDenominations[0] || 65;
  for (let i = allowedDenominations.length - 1; i >= 0; i--) {
    if (incBal >= allowedDenominations[i]) {
      defaultAmount = allowedDenominations[i];
      break;
    }
  }

  renderDynamicAmountGrid({
    selectId: "withdraw-modal-amount",
    gridId: "withdraw-pills-grid",
    amounts: allowedDenominations,
    selectedAmount: defaultAmount,
    includeAutoMax: false,
    onClickFnName: "selectWithdrawAmount"
  });

  document.getElementById("withdraw-modal-pin").value = "";

  const statusBox = document.getElementById("withdraw-status-banner");
  if (statusBox) {
    statusBox.style.display = "none";
    statusBox.className = "verify-status-banner";
    statusBox.innerHTML = "";
  }

  document.getElementById("withdraw-modal").classList.add("active");
}

export function closeWithdrawModal() {
  document.getElementById("withdraw-modal").classList.remove("active");
}

export async function handleManualWithdrawSubmit(e) {
  e.preventDefault();
  const accId = document.getElementById("withdraw-acc-id").value;
  const amount = parseFloat(document.getElementById("withdraw-modal-amount").value);
  const walletFlag = parseInt(document.getElementById("withdraw-modal-wallet").value, 10);
  const pin = document.getElementById("withdraw-modal-pin").value.trim();
  const statusBox = document.getElementById("withdraw-status-banner");
  const submitBtn = document.getElementById("btn-submit-withdraw");

  if (!amount || amount <= 0) {
    statusBox.style.display = "flex";
    statusBox.className = "verify-status-banner verify-error";
    statusBox.innerHTML = "⚠️ Please enter a valid withdrawal amount.";
    return;
  }
  if (!pin) {
    statusBox.style.display = "flex";
    statusBox.className = "verify-status-banner verify-error";
    statusBox.innerHTML = "⚠️ Please enter your transaction PIN / payment password.";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="btn-icon">⏳</span> Submitting to Ace775...';
  statusBox.style.display = "flex";
  statusBox.className = "verify-status-banner verify-loading";
  statusBox.innerHTML = "⏳ Contacting payment gateway...";

  try {
    const data = await api.submitWithdrawal(accId, {
      amount: amount,
      withdrawl_flag: walletFlag,
      pay_password: pin
    });

    statusBox.className = "verify-status-banner verify-success";
    statusBox.innerHTML = `✅ <strong>Success!</strong> ${escapeHtml(data.message || 'Withdrawal submitted successfully.')}`;
    appendTerminalLog(`💸 [WITHDRAW] Successfully requested ${amount} GHS for account #${accId}`, "success");

    setTimeout(() => {
      closeWithdrawModal();
      loadAccounts();
      loadStats();
    }, 1200);
  } catch (err) {
    statusBox.className = "verify-status-banner verify-error";
    statusBox.innerHTML = `❌ <strong>Failed:</strong> ${escapeHtml(err.message)}`;
    appendTerminalLog(`❌ [WITHDRAW] Failed for account #${accId}: ${err.message}`, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span class="btn-icon">💸</span> Confirm & Submit Withdrawal';
  }
}

/* ==============================================================================
   3. Execution Audit History Modal
   ============================================================================== */
export async function openHistoryModal(accountId = null) {
  const modal = document.getElementById("history-modal");
  const tbody = document.getElementById("history-table-body");
  const countBadge = document.getElementById("badge-history-count");
  const title = document.getElementById("history-modal-title");

  modal.classList.add("active");
  tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Loading audit records...</td></tr>`;

  try {
    const records = await api.getHistory(accountId);
    if (countBadge) countBadge.innerText = records.length;

    if (accountId) {
      const acc = getAccountById(accountId);
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
        <td style="font-family:var(--font-mono); font-size:0.8rem; color:var(--text-dim); white-space:nowrap;">${escapeHtml(r.run_time || '')}</td>
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

export async function loadAuditHistoryTable(accountId = null) {
  const tbody = document.getElementById("history-page-table-body");
  const countBadge = document.getElementById("badge-history-page-count");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Loading audit records...</td></tr>`;

  try {
    const records = await api.getHistory(accountId);
    if (countBadge) countBadge.innerText = records.length;

    if (records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No execution history recorded yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = records.map(r => `
      <tr>
        <td style="font-family:var(--font-mono); font-size:0.8rem; color:var(--text-dim); white-space:nowrap;">${escapeHtml(r.run_time || '')}</td>
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

export function loadWithdrawalsView() {
  const accs = state.accounts || [];
  loadWithdrawalQueue();

  // Populate account dropdown in Auto-Withdrawal Configurator Card
  const accSelect = document.getElementById("withdraw-page-acc-select");
  if (accSelect) {
    const currentVal = accSelect.value;
    accSelect.innerHTML = `<option value="">-- Choose Account to Configure --</option>` + accs.map(a => `
      <option value="${a.id}">${escapeHtml(a.label || a.phone)} (${a.balance || '0.00'} GHS)</option>
    `).join("");

    if (currentVal && accs.some(a => String(a.id) === String(currentVal))) {
      accSelect.value = currentVal;
    } else if (accs.length > 0) {
      accSelect.value = String(accs[0].id);
      onWithdrawPageAccountChange();
    }
  }

  // Populate withdrawals table
  const tbody = document.getElementById("withdrawals-table-body");
  if (tbody) {
    if (accs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty">No accounts available. Add an account to get started.</td></tr>`;
      return;
    }
    const todayStr = new Date().toISOString().split('T')[0];
    tbody.innerHTML = accs.map(a => {
      const inc = a.income_balance ? Number(a.income_balance).toFixed(2) : (a.balance || '0.00');
      const isHolding = a.last_withdraw_status && a.last_withdraw_status.toLowerCase().startsWith('holding');
      return `
      <tr>
        <td>
          <strong>${escapeHtml(a.label || a.phone)}</strong>
          <br><small style="color:var(--text-dim)">+233 ${escapeHtml(a.phone)}</small>
          <div style="margin-top:3px;"><span class="badge" style="background:rgba(59,130,246,0.12); color:var(--accent-blue); font-size:0.7rem;">${escapeHtml(a.vip_level || 'VIP')}${a.withdrawal_fee ? ' • ' + a.withdrawal_fee + '% fee' : ''}</span></div>
        </td>
        <td>
          <strong style="color:var(--accent-cyan); font-family:var(--font-mono);">${inc} GHS</strong>
          <br><small style="color:var(--text-dim)">Income Wallet</small>
        </td>
        <td>
          <span class="badge ${a.auto_withdraw === 1 ? 'badge-active' : 'badge-paused'}">
            ${a.auto_withdraw === 1 ? 'ENABLED' : 'DISABLED'}
          </span>
        </td>
        <td>
          <span class="badge" style="background:rgba(255,255,255,0.06); font-family:var(--font-mono);">${a.withdraw_amount > 0 ? a.withdraw_amount + ' GHS' : 'Full Bal'}</span>
          <br><small style="color:var(--text-dim); font-size:0.75rem;">Min: ${(a.withdrawal_amounts && a.withdrawal_amounts[0]) || 65} GHS</small>
        </td>
        <td style="font-family:var(--font-mono); font-size:0.8rem; color:var(--text-dim);">${a.last_withdraw_date ? escapeHtml(a.last_withdraw_date) : 'None'}</td>
        <td>
          <span style="font-size:0.8rem; color:${isHolding ? 'var(--warning)' : (a.last_withdraw_date === todayStr ? 'var(--success)' : 'var(--text-dim)')}">
            ${isHolding ? '⏳ ' : ''}${escapeHtml(a.last_withdraw_status || 'Ready')}
          </span>
        </td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn btn-xs btn-secondary" onclick="configureAutoWithdrawForAccount(${a.id})" title="Configure Auto-Withdrawal">
            ⚙️ Setup
          </button>
          <button class="btn btn-xs btn-primary" onclick="openWithdrawModal(${a.id})" title="Request Instant Withdrawal">
            💸 Withdraw
          </button>
        </td>
      </tr>
      `;
    }).join("");
  }
}

export async function loadWithdrawalQueue() {
  const tbody = document.getElementById("withdrawal-queue-tbody");
  const badge = document.getElementById("badge-queue-count");
  if (!tbody) return;

  try {
    const data = await api.getWithdrawalQueue();
    const queue = (data && data.queue) || [];
    const pendingCount = queue.filter(q => q.status === 'queued' || q.status === 'processing').length;
    if (badge) {
      badge.textContent = `${pendingCount} Pending`;
      badge.style.background = pendingCount > 0 ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.06)";
      badge.style.color = pendingCount > 0 ? "var(--accent-green)" : "var(--text-muted)";
    }

    if (queue.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty">No active or pending withdrawals in queue.</td></tr>`;
      return;
    }

    tbody.innerHTML = queue.map(item => {
      const isQueued = item.status === 'queued';
      const isProcessing = item.status === 'processing';
      const isCompleted = item.status === 'completed';
      const isFailed = item.status === 'failed';

      let statusBadge = '';
      if (isQueued) {
        statusBadge = `<span class="badge" style="background:rgba(245,158,11,0.15); color:var(--accent-gold);">⏳ QUEUED</span>`;
      } else if (isProcessing) {
        statusBadge = `<span class="badge" style="background:rgba(59,130,246,0.15); color:var(--accent-blue);">⚙️ PROCESSING</span>`;
      } else if (isCompleted) {
        statusBadge = `<span class="badge" style="background:rgba(16,185,129,0.15); color:var(--accent-green);">✅ COMPLETED</span>`;
      } else {
        statusBadge = `<span class="badge" style="background:rgba(239,68,68,0.15); color:var(--danger);">${escapeHtml((item.status || 'FAILED').toUpperCase())}</span>`;
      }

      return `
        <tr>
          <td style="font-family:var(--font-mono); font-size:0.8rem; color:var(--text-dim);">#${item.id}</td>
          <td>
            <strong>${escapeHtml(item.label || item.phone)}</strong>
            <br><small style="color:var(--text-dim)">+233 ${escapeHtml(item.phone)}</small>
          </td>
          <td>
            <strong style="color:var(--accent-cyan); font-family:var(--font-mono);">${Number(item.amount).toFixed(2)} GHS</strong>
            <br><small style="color:var(--text-dim); font-size:0.75rem;">${item.wallet_flag === 1 ? 'Personal Wallet' : 'Income Wallet'}</small>
          </td>
          <td>${statusBadge}</td>
          <td>
            <strong style="font-family:var(--font-mono); font-size:0.85rem; color:${isQueued ? 'var(--accent-gold)' : 'var(--text-main)'};">
              ${escapeHtml(item.scheduled_for || 'Now')}
            </strong>
            <br><small style="color:var(--text-dim); font-size:0.75rem;">Queued: ${escapeHtml(item.queued_at ? item.queued_at.split(' ')[1] || item.queued_at : '')}</small>
          </td>
          <td style="font-size:0.8rem; color:${isCompleted ? 'var(--accent-green)' : (isFailed ? 'var(--danger)' : 'var(--text-muted)')};">
            ${escapeHtml(item.result_message || (isQueued ? 'Scheduled (Anti-clustering spacing)' : 'Waiting...'))}
          </td>
          <td style="text-align:right;">
            ${isQueued ? `
              <button class="btn btn-xs btn-danger" onclick="cancelQueueItem(${item.id})" title="Cancel this queued withdrawal">
                ✕ Cancel
              </button>
            ` : `<span style="color:var(--text-dim); font-size:0.75rem;">—</span>`}
          </td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color:var(--danger)">Error loading queue: ${escapeHtml(err.message)}</td></tr>`;
  }
}

export async function cancelQueueItem(queueId) {
  if (!confirm(`Are you sure you want to cancel queued withdrawal #${queueId}?`)) return;
  try {
    await api.cancelWithdrawalQueue(queueId);
    await loadWithdrawalQueue();
    if (state.accounts) loadWithdrawalsView();
  } catch (err) {
    alert("Cancellation failed: " + err.message);
  }
}

export function onWithdrawPageAccountChange() {
  const accSelect = document.getElementById("withdraw-page-acc-select");
  if (!accSelect) return;
  const accId = accSelect.value;
  const hint = document.getElementById("withdraw-page-acc-hint");

  if (!accId) {
    if (hint) hint.innerText = "Select an account to load or update its auto-withdrawal rule.";
    return;
  }
  const acc = getAccountById(accId);
  if (!acc) return;

  const incBal = acc.income_balance ? Number(acc.income_balance).toFixed(2) : (acc.balance || '0.00');
  const feeText = acc.withdrawal_fee ? ` • Fee: <strong>${acc.withdrawal_fee}%</strong>` : "";
  const allowedTiers = (acc.withdrawal_amounts && acc.withdrawal_amounts.length > 0)
    ? acc.withdrawal_amounts
    : DEFAULT_PLATFORM_DENOMINATIONS;
  const minTier = allowedTiers[0] || 65;

  if (hint) {
    hint.innerHTML = `VIP Level: <strong>${escapeHtml(acc.vip_level || 'VIP')}</strong>${feeText} | Min: <strong>${minTier} GHS</strong> | Available Income Wallet: <strong style="color:var(--accent-cyan); font-family:var(--font-mono);">${incBal} GHS</strong> | Total: <span style="color:var(--text-dim);">${acc.balance || '0.00'} GHS</span>`;
  }
  document.getElementById("withdraw-page-auto-toggle").checked = (acc.auto_withdraw === 1);
  const targetAmount = acc.withdraw_amount || 0;

  renderDynamicAmountGrid({
    selectId: "withdraw-page-fixed-amount",
    gridId: "withdraw-page-pills-grid",
    amounts: allowedTiers,
    selectedAmount: targetAmount,
    includeAutoMax: true,
    onClickFnName: "selectWithdrawPageAmount"
  });

  document.getElementById("withdraw-page-wallet").value = String(acc.withdraw_wallet || 2);
  const pinInput = document.getElementById("withdraw-page-pin");
  if (pinInput) {
    pinInput.value = "";
    pinInput.placeholder = acc.pay_password ? "•••••• (PIN already configured)" : "Enter 6-digit payment PIN";
  }

  const banner = document.getElementById("withdraw-page-status-banner");
  if (banner) {
    banner.style.display = "none";
    banner.className = "verify-status-banner";
    banner.innerHTML = "";
  }
}

export async function refreshAccountWithdrawalOptions() {
  const accSelect = document.getElementById("withdraw-page-acc-select");
  if (!accSelect || !accSelect.value) {
    alert("Please select an account first.");
    return;
  }
  const accId = accSelect.value;
  const btn = document.getElementById("btn-sync-withdraw-tiers");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Syncing...';
  }

  try {
    const data = await api.getWithdrawalOptions(accId, true);
    if (state.accounts) {
      const idx = state.accounts.findIndex(a => String(a.id) === String(accId));
      if (idx !== -1) {
        state.accounts[idx] = { ...state.accounts[idx], ...data };
      }
    }
    onWithdrawPageAccountChange();
    loadWithdrawalsView();
    alert(`✅ Tiers updated for ${data.label}! VIP: ${data.vip_level}, Fee: ${data.withdrawal_fee}%, ${data.withdrawal_amounts.length} platform tiers loaded.`);
  } catch (err) {
    alert(`Sync failed: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🔄 Sync Tiers from Ace775';
    }
  }
}

export function configureAutoWithdrawForAccount(accountId) {
  const select = document.getElementById("withdraw-page-acc-select");
  if (select) {
    select.value = String(accountId);
    onWithdrawPageAccountChange();
  }
  const card = document.getElementById("card-auto-withdraw-setup");
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

export async function handlePagedAutoWithdrawSubmit(e) {
  e.preventDefault();
  const accSelect = document.getElementById("withdraw-page-acc-select");
  const accId = accSelect ? accSelect.value : null;
  const banner = document.getElementById("withdraw-page-status-banner");
  const btn = document.getElementById("btn-save-paged-withdraw");

  if (!accId) {
    if (banner) {
      banner.style.display = "flex";
      banner.className = "verify-status-banner verify-error";
      banner.innerHTML = "⚠️ Please select an account first.";
    }
    return;
  }

  const enabled = document.getElementById("withdraw-page-auto-toggle").checked ? 1 : 0;
  const amount = parseFloat(document.getElementById("withdraw-page-fixed-amount").value) || 0.0;
  const wallet = parseInt(document.getElementById("withdraw-page-wallet").value, 10) || 2;
  const pin = document.getElementById("withdraw-page-pin").value.trim();

  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Saving Rule...';
  if (banner) {
    banner.style.display = "flex";
    banner.className = "verify-status-banner verify-loading";
    banner.innerHTML = "⏳ Updating auto-withdrawal configuration...";
  }

  const payload = {
    auto_withdraw: enabled,
    withdraw_amount: amount,
    withdraw_wallet: wallet
  };
  if (pin) {
    payload.pay_password = pin;
  }

  try {
    await api.saveAccount(accId, payload);
    if (banner) {
      banner.className = "verify-status-banner verify-success";
      banner.innerHTML = `✅ <strong>Auto-Withdrawal Rule Saved!</strong> Fixed target: <strong>${amount > 0 ? amount + ' GHS' : 'Full Balance'}</strong> (${enabled ? 'ENABLED' : 'DISABLED'}).`;
    }
    appendTerminalLog(`⚙️ [WITHDRAW] Auto-withdrawal rule configured for account #${accId}: ${amount > 0 ? amount + ' GHS' : 'Full Balance'} (${enabled ? 'ACTIVE' : 'INACTIVE'})`, "success");
    await loadAccounts();
    loadWithdrawalsView();
  } catch (err) {
    if (banner) {
      banner.className = "verify-status-banner verify-error";
      banner.innerHTML = `❌ <strong>Save Failed:</strong> ${escapeHtml(err.message)}`;
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">💾</span> Save Auto-Withdrawal Rule';
  }
}

export function closeHistoryModal() {
  document.getElementById("history-modal").classList.remove("active");
}

/* ==============================================================================
   4. CSV Batch Import Modal
   ============================================================================== */
export function openImportModal() {
  document.getElementById("import-modal").classList.add("active");
}

export function closeImportModal() {
  document.getElementById("import-modal").classList.remove("active");
}

export function handleCsvFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    document.getElementById("csv-textarea").value = evt.target.result;
  };
  reader.readAsText(file);
}

export async function handleCsvImport(e) {
  e.preventDefault();
  const content = document.getElementById("csv-textarea").value.trim();
  const banner = document.getElementById("import-status-banner");
  const btn = document.getElementById("btn-submit-import");

  if (!content) {
    alert("Please paste CSV lines or choose a file.");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Importing...';
  banner.style.display = "flex";
  banner.className = "verify-status-banner verify-loading";
  banner.innerHTML = "⏳ Parsing and verifying imported accounts...";

  try {
    const data = await api.importCsv(content);
    banner.className = "verify-status-banner verify-success";
    banner.innerHTML = `🎉 <strong>Import Finished!</strong> Added: ${data.imported_count}, Skipped/Duplicates: ${data.skipped_count}`;
    appendTerminalLog(`[IMPORT] CSV Import complete. ${data.imported_count} accounts added.`, "success");

    setTimeout(() => {
      closeImportModal();
      loadAccounts();
      loadStats();
    }, 1200);
  } catch (err) {
    banner.className = "verify-status-banner verify-error";
    banner.innerHTML = `❌ <strong>Import Error:</strong> ${escapeHtml(err.message)}`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">⚡</span> Verify & Import All';
  }
}

/* ==============================================================================
   5. Settings Modal
   ============================================================================== */
export function openSettingsModal() {
  loadSettings();
  document.getElementById("settings-modal").classList.add("active");
}

export function closeSettingsModal() {
  document.getElementById("settings-modal").classList.remove("active");
}

export async function loadSettings() {
  try {
    const data = await api.getSettings();
    document.getElementById("set-base-url").value = data.base_url || "https://ace775.com";
    document.getElementById("set-tg-token").value = data.telegram_token || "";
    document.getElementById("set-tg-chat").value = data.telegram_chat_id || "";
    document.getElementById("set-sched-time").value = data.schedule_time || "09:00";
    document.getElementById("set-sched-time-2").value = data.schedule_time_2 || "";
    document.getElementById("set-retry-mins").value = data.retry_interval_minutes || "30";
    document.getElementById("set-sched-enabled").checked = data.schedule_enabled === "1";
    document.getElementById("set-auto-retry").checked = data.auto_retry_outside_hours === "1";
    const minSpacing = document.getElementById("set-min-spacing");
    if (minSpacing) minSpacing.value = data.min_withdrawal_spacing_minutes || "25";
    const maxSpacing = document.getElementById("set-max-spacing");
    if (maxSpacing) maxSpacing.value = data.max_withdrawal_spacing_minutes || "50";
  } catch (err) {
    console.error("Failed to load settings:", err);
  }
}

export async function handleSettingsSubmit(e) {
  e.preventDefault();
  const minSpacing = document.getElementById("set-min-spacing");
  const maxSpacing = document.getElementById("set-max-spacing");

  const payload = {
    base_url: document.getElementById("set-base-url").value.trim(),
    telegram_token: document.getElementById("set-tg-token").value.trim(),
    telegram_chat_id: document.getElementById("set-tg-chat").value.trim(),
    schedule_time: document.getElementById("set-sched-time").value.trim(),
    schedule_time_2: document.getElementById("set-sched-time-2").value.trim(),
    retry_interval_minutes: document.getElementById("set-retry-mins").value.trim(),
    schedule_enabled: document.getElementById("set-sched-enabled").checked ? "1" : "0",
    auto_retry_outside_hours: document.getElementById("set-auto-retry").checked ? "1" : "0",
    min_withdrawal_spacing_minutes: minSpacing ? minSpacing.value.trim() : "25",
    max_withdrawal_spacing_minutes: maxSpacing ? maxSpacing.value.trim() : "50"
  };

  try {
    await api.saveSettings(payload);
    closeSettingsModal();
    loadSchedulerStatus();
    appendTerminalLog("[SYSTEM] Settings and Auto-Scheduler updated successfully.", "success");
  } catch (err) {
    alert("Error: " + err.message);
  }
}
