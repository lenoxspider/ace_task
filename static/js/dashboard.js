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
  loadWithdrawalQueue,
  cancelQueueItem,
  openImportModal,
  closeImportModal,
  handleCsvFileUpload,
  handleCsvImport,
  openSettingsModal,
  closeSettingsModal,
  loadSettings,
  handleSettingsSubmit,
  switchSettingsTab,
  testTelegramConnection
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
window.switchSettingsTab = switchSettingsTab;
window.testTelegramConnection = testTelegramConnection;

// Page Data Loaders
window.clearTerminalLogs = clearTerminalLogs;
window.loadStats = loadStats;
window.loadAccounts = loadAccounts;
window.loadAnalytics = loadAnalytics;
window.loadSchedulerStatus = loadSchedulerStatus;
window.loadSettings = loadSettings;
window.loadAuditHistoryTable = loadAuditHistoryTable;
window.loadWithdrawalsView = loadWithdrawalsView;
window.loadWithdrawalQueue = loadWithdrawalQueue;
window.cancelQueueItem = cancelQueueItem;

// Desktop Collapsible Sidebar
export function initSidebarCollapse() {
  const isCollapsed = localStorage.getItem("ace_sidebar_collapsed") === "true";
  const appShell = document.querySelector(".app-shell");
  if (isCollapsed && appShell) {
    appShell.classList.add("sidebar-collapsed");
  }
  updateSidebarCollapseButton(isCollapsed);

  // Keyboard shortcut Ctrl+B or Cmd+B
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
      const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      e.preventDefault();
      toggleSidebarCollapse();
    }
  });
}

export function toggleSidebarCollapse() {
  const appShell = document.querySelector(".app-shell");
  if (!appShell) return;
  const isCollapsed = appShell.classList.toggle("sidebar-collapsed");
  localStorage.setItem("ace_sidebar_collapsed", isCollapsed ? "true" : "false");
  updateSidebarCollapseButton(isCollapsed);
}

function updateSidebarCollapseButton(isCollapsed) {
  const btn = document.getElementById("btn-sidebar-collapse");
  if (!btn) return;
  const icon = btn.querySelector(".collapse-icon");
  if (isCollapsed) {
    btn.title = "Expand sidebar (Ctrl+B)";
    btn.setAttribute("aria-label", "Expand sidebar");
    if (icon) icon.textContent = "▶";
  } else {
    btn.title = "Collapse sidebar (Ctrl+B)";
    btn.setAttribute("aria-label", "Collapse sidebar");
    if (icon) icon.textContent = "◀";
  }
}

window.toggleSidebarCollapse = toggleSidebarCollapse;

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
  initSidebarCollapse();
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
