/**
 * Ace775 Command Center - Master Application Bootstrap
 * Orchestrates modular components, state management, and real-time streams.
 */

import { api } from "./modules/api.js";
import { state, setAccounts } from "./modules/state.js";
import { initTheme, toggleTheme } from "./modules/theme.js";
import { initTerminal, appendTerminalLog, clearTerminalLogs } from "./modules/terminal.js";
import {
  renderAccounts,
  loadAccounts,
  toggleAccountPause,
  runAccount,
  runAllAccounts,
  refreshAccountBalance,
  deleteAccount,
  filterAccounts,
  setAccountFilter,
  updateRunningVisuals
} from "./modules/accounts.js";
import { loadStats } from "./modules/stats.js";
import { loadAnalytics } from "./modules/analytics.js";
import { loadSchedulerStatus } from "./modules/scheduler.js";
import {
  openAccountModal,
  editAccount,
  closeAccountModal,
  toggleAutoWithdrawFields,
  testAccountLogins,
  handleAccountSubmit,
  openWithdrawModal,
  closeWithdrawModal,
  handleManualWithdrawSubmit,
  openHistoryModal,
  closeHistoryModal,
  openImportModal,
  closeImportModal,
  handleCsvFileUpload,
  handleCsvImport,
  openSettingsModal,
  closeSettingsModal,
  handleSettingsSubmit
} from "./modules/modals.js";

// Expose handlers to window for HTML event attributes
window.toggleTheme = toggleTheme;
window.handleLogout = () => api.logout();

window.toggleAccountPause = toggleAccountPause;
window.runAccount = runAccount;
window.runAllAccounts = runAllAccounts;
window.refreshAccountBalance = refreshAccountBalance;
window.deleteAccount = deleteAccount;
window.filterAccounts = filterAccounts;
window.setAccountFilter = setAccountFilter;

window.openAccountModal = openAccountModal;
window.editAccount = editAccount;
window.closeAccountModal = closeAccountModal;
window.toggleAutoWithdrawFields = toggleAutoWithdrawFields;
window.testAccountLogins = testAccountLogins;
window.handleAccountSubmit = handleAccountSubmit;

window.openWithdrawModal = openWithdrawModal;
window.closeWithdrawModal = closeWithdrawModal;
window.handleManualWithdrawSubmit = handleManualWithdrawSubmit;

window.openHistoryModal = openHistoryModal;
window.closeHistoryModal = closeHistoryModal;

window.openImportModal = openImportModal;
window.closeImportModal = closeImportModal;
window.handleCsvFileUpload = handleCsvFileUpload;
window.handleCsvImport = handleCsvImport;

window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.handleSettingsSubmit = handleSettingsSubmit;

window.clearTerminalLogs = clearTerminalLogs;
window.loadStats = loadStats;
window.loadAccounts = loadAccounts;

window.toggleMobileMenu = function() {
  const actions = document.getElementById("header-actions");
  if (actions) actions.classList.toggle("open");
};

// Check active runs
async function checkActiveRuns() {
  try {
    const res = await api.request("/api/run/active");
    if (!res.ok) return;
    const data = await res.json();
    state.runningAccountIds = new Set(data.running_ids || []);

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

// Bootstrap
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  loadSchedulerStatus();
  loadStats();
  loadAnalytics();
  loadAccounts();

  // Initialize live terminal SSE stream with reactive state hooks
  initTerminal((refreshAccounts = false) => {
    updateRunningVisuals();
    if (refreshAccounts) {
      loadAccounts();
      loadStats();
      loadAnalytics();
      loadSchedulerStatus();
    }
  });

  // Periodic polls
  setInterval(checkActiveRuns, 4000);
  setInterval(loadSchedulerStatus, 30000);
});
