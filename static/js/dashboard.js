/**
 * Ace775 Command Center - Master Application Bootstrap
 * Orchestrates modular components, state management, multi-page router, and real-time streams.
 */

import { api } from "./modules/api.js";
import { state, setAccounts } from "./modules/state.js";
import { initTheme, toggleTheme } from "./modules/theme.js";
import { initRouter, navigate } from "./modules/router.js";
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
  selectWithdrawAmount,
  syncWithdrawPills,
  selectFormWithdrawAmount,
  syncFormWithdrawPills,
  selectWithdrawPageAmount,
  syncWithdrawPagePills,
  onWithdrawPageAccountChange,
  refreshAccountWithdrawalOptions,
  configureAutoWithdrawForAccount,
  handlePagedAutoWithdrawSubmit,
  openHistoryModal,
  closeHistoryModal,
  loadAuditHistoryTable,
  loadWithdrawalsView,
  openImportModal,
  closeImportModal,
  handleCsvFileUpload,
  handleCsvImport,
  openSettingsModal,
  closeSettingsModal,
  loadSettings,
  handleSettingsSubmit
} from "./modules/modals.js";

// Multi-Page Router Navigation
window.navigate = navigate;

// Theme & Auth
window.toggleTheme = toggleTheme;
window.handleLogout = () => api.logout();

// Account Actions
window.toggleAccountPause = toggleAccountPause;
window.runAccount = runAccount;
window.runAllAccounts = runAllAccounts;
window.refreshAccountBalance = refreshAccountBalance;
window.deleteAccount = deleteAccount;
window.filterAccounts = filterAccounts;
window.setAccountFilter = setAccountFilter;

// Modals
window.openAccountModal = openAccountModal;
window.editAccount = editAccount;
window.closeAccountModal = closeAccountModal;
window.toggleAutoWithdrawFields = toggleAutoWithdrawFields;
window.testAccountLogins = testAccountLogins;
window.handleAccountSubmit = handleAccountSubmit;

// Withdrawal Fixed Amount Selection & Operations
window.selectWithdrawAmount = selectWithdrawAmount;
window.syncWithdrawPills = syncWithdrawPills;
window.selectFormWithdrawAmount = selectFormWithdrawAmount;
window.syncFormWithdrawPills = syncFormWithdrawPills;
window.selectWithdrawPageAmount = selectWithdrawPageAmount;
window.syncWithdrawPagePills = syncWithdrawPagePills;
window.onWithdrawPageAccountChange = onWithdrawPageAccountChange;
window.refreshAccountWithdrawalOptions = refreshAccountWithdrawalOptions;
window.configureAutoWithdrawForAccount = configureAutoWithdrawForAccount;
window.handlePagedAutoWithdrawSubmit = handlePagedAutoWithdrawSubmit;

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

// Page Data Loaders
window.clearTerminalLogs = clearTerminalLogs;
window.loadStats = loadStats;
window.loadAccounts = loadAccounts;
window.loadAnalytics = loadAnalytics;
window.loadSchedulerStatus = loadSchedulerStatus;
window.loadSettings = loadSettings;
window.loadAuditHistoryTable = loadAuditHistoryTable;
window.loadWithdrawalsView = loadWithdrawalsView;

// Mobile Sidebar Drawer
window.toggleMobileMenu = function() {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (sidebar) sidebar.classList.toggle("open");
  if (backdrop) backdrop.classList.toggle("active");
};

// Check active runs periodically
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

// Bootstrap Application
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initRouter();
  loadSchedulerStatus();
  loadStats();
  loadAnalytics();
  loadAccounts();

  // Initialize live terminal SSE stream
  initTerminal((refreshAccounts = false) => {
    updateRunningVisuals();
    if (refreshAccounts) {
      loadAccounts();
      loadStats();
      loadAnalytics();
      loadSchedulerStatus();
    }
  });

  // Periodic background sync
  setInterval(checkActiveRuns, 4000);
  setInterval(loadSchedulerStatus, 30000);
});
