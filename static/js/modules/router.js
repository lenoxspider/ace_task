/**
 * Ace775 Command Center - Multi-Page Client-Side Router Module
 */

export const routes = ["overview", "accounts", "terminal", "history", "withdrawals", "settings"];

let currentPage = "overview";

export function getCurrentPage() {
  return currentPage;
}

export function navigate(pageId, push = true) {
  if (!routes.includes(pageId)) {
    pageId = "overview";
  }

  currentPage = pageId;

  // 1. Toggle Page Views
  document.querySelectorAll(".page-view").forEach(el => {
    el.classList.remove("active");
  });
  const targetPage = document.getElementById(`page-${pageId}`);
  if (targetPage) {
    targetPage.classList.add("active");
  }

  // 2. Update Nav Links
  document.querySelectorAll(".nav-link").forEach(link => {
    link.classList.toggle("active", link.dataset.page === pageId);
  });

  // 3. Update Browser URL
  if (push) {
    const url = pageId === "overview" ? "/" : `/${pageId}`;
    window.history.pushState({ page: pageId }, "", url);
  }

  // 4. Close mobile sidebar if open
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (sidebar) sidebar.classList.remove("open");
  if (backdrop) backdrop.classList.remove("active");

  // 5. Trigger Page-Specific Lifecycle Hooks
  onPageEnter(pageId);
}

function onPageEnter(pageId) {
  if (pageId === "overview") {
    if (window.loadStats) window.loadStats();
    if (window.loadAnalytics) window.loadAnalytics();
    if (window.loadAccounts) window.loadAccounts();
    if (window.loadSchedulerStatus) window.loadSchedulerStatus();
  } else if (pageId === "accounts") {
    if (window.loadAccounts) window.loadAccounts();
    if (window.loadStats) window.loadStats();
  } else if (pageId === "history") {
    if (window.loadAuditHistoryTable) window.loadAuditHistoryTable();
  } else if (pageId === "withdrawals") {
    if (window.loadWithdrawalsView) window.loadWithdrawalsView();
  } else if (pageId === "settings") {
    if (window.loadSettings) window.loadSettings();
    if (window.loadSchedulerStatus) window.loadSchedulerStatus();
  }
}

export function initRouter() {
  // Listen to browser popstate (Back/Forward)
  window.addEventListener("popstate", (e) => {
    const page = (e.state && e.state.page) ? e.state.page : getPageFromPath();
    navigate(page, false);
  });

  // Initial route resolution
  const initialPage = getPageFromPath();
  navigate(initialPage, false);
}

function getPageFromPath() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, "");
  if (routes.includes(path)) {
    return path;
  }
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (routes.includes(hash)) {
    return hash;
  }
  return "overview";
}
