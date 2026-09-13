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
  document.getElementById("form-withdraw-amount").value = acc ? (acc.withdraw_amount || 0) : 0;
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
  statusBox.innerHTML = "⏳ Connecting to Ace775 to verify credentials...";

  try {
    const data = await api.verifyLogin({
      phone: phone,
      password: password,
      account_id: id ? parseInt(id, 10) : null
    });
    statusBox.className = "verify-status-banner verify-success";
    statusBox.innerHTML = `✅ <strong>Login Success!</strong> VIP Level: ${escapeHtml(data.vip_level || 'VIP')} | Balance: ${data.balance || '0.00'} GHS`;
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
   2. Manual Withdrawal Modal
   ============================================================================== */
export function openWithdrawModal(accountId) {
  const acc = getAccountById(accountId);
  if (!acc) return;

  document.getElementById("withdraw-acc-id").value = acc.id;
  document.getElementById("withdraw-account-label").innerText = `${acc.label || 'Account'} (+233 ${acc.phone})`;
  document.getElementById("withdraw-account-balance").innerText = `${acc.balance || '0.00'} GHS`;
  document.getElementById("withdraw-modal-amount").value = acc.balance || "";
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
  } catch (err) {
    console.error("Failed to load settings:", err);
  }
}

export async function handleSettingsSubmit(e) {
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
    await api.saveSettings(payload);
    closeSettingsModal();
    loadSchedulerStatus();
    appendTerminalLog("[SYSTEM] Settings and Auto-Scheduler updated successfully.", "success");
  } catch (err) {
    alert("Error: " + err.message);
  }
}
