/**
 * Ace775 Command Center - Live Automation Terminal Console Module
 * Features log filtering (All/Info/Warning/Error), search, pause autoscroll, and batching.
 */

import { state } from "./state.js";

let activeFilter = "all";
let activeSearch = "";
let isPaused = false;
let pendingBuffer = [];
let flushScheduled = false;

export function initTerminal(onAccountStateChange) {
  if (state.eventSource) {
    state.eventSource.close();
  }

  state.eventSource = new EventSource("/api/logs/stream");

  state.eventSource.onmessage = (event) => {
    if (!event.data || event.data.includes("ping")) return;
    const rawLine = event.data;

    // Handle real-time account running indicators
    if (rawLine.includes("[ACCOUNT_RUNNING:")) {
      const match = rawLine.match(/\[ACCOUNT_RUNNING:(\d+)\]/);
      if (match) {
        state.runningAccountIds.add(Number(match[1]));
        if (onAccountStateChange) onAccountStateChange();
      }
      return;
    }

    if (rawLine.includes("[ACCOUNT_IDLE:")) {
      const match = rawLine.match(/\[ACCOUNT_IDLE:(\d+)\]/);
      if (match) {
        state.runningAccountIds.delete(Number(match[1]));
        if (onAccountStateChange) onAccountStateChange(true);
      }
      return;
    }

    // Determine level
    let level = "info";
    if (rawLine.includes("[SUCCESS]") || rawLine.includes("✅") || rawLine.includes("🎉") || rawLine.includes("Completed")) {
      level = "success";
    } else if (rawLine.includes("[WARNING]") || rawLine.includes("⚠️") || rawLine.includes("⏳") || rawLine.includes("⏸️")) {
      level = "warning";
    } else if (rawLine.includes("[ERROR]") || rawLine.includes("❌") || rawLine.includes("Failed")) {
      level = "error";
    }

    queueLogEntry(rawLine, level);
  };

  state.eventSource.onerror = () => {
    // EventSource handles reconnection automatically
  };

  initToolbarEvents();
}

function queueLogEntry(text, level) {
  const timeStr = new Date().toLocaleTimeString("en-GB", { hour12: false });
  pendingBuffer.push({ text, level, time: timeStr });

  if (!flushScheduled) {
    flushScheduled = true;
    requestAnimationFrame(flushPendingLogs);
  }
}

function flushPendingLogs() {
  flushScheduled = false;
  const items = pendingBuffer.splice(0, pendingBuffer.length);
  if (items.length === 0) return;

  const containers = [
    document.getElementById("terminal-logs"),
    document.getElementById("terminal-page-logs")
  ].filter(Boolean);

  containers.forEach(container => {
    const fragment = document.createDocumentFragment();
    items.forEach(item => {
      const el = createLogElement(item.text, item.level, item.time);
      fragment.appendChild(el);
    });
    container.appendChild(fragment);

    // Trim older DOM nodes to prevent memory leak
    while (container.childNodes.length > 250) {
      container.removeChild(container.firstChild);
    }

    if (!isPaused) {
      container.scrollTop = container.scrollHeight;
    }
  });
}

function createLogElement(text, level, timeStr) {
  const el = document.createElement("div");
  el.className = `log-line log-${level}`;
  el.dataset.level = level;
  el.dataset.text = text.toLowerCase();

  if (!matchesFilters(level, text)) {
    el.classList.add("log-hidden");
  }

  el.innerHTML = `
    <span class="log-time">${timeStr}</span>
    <span class="log-badge">${level}</span>
    <span class="log-text">${escapeHtml(text)}</span>
  `;
  return el;
}

function matchesFilters(level, text) {
  if (activeFilter !== "all" && level !== activeFilter) {
    return false;
  }
  if (activeSearch && !text.toLowerCase().includes(activeSearch)) {
    return false;
  }
  return true;
}

export function appendTerminalLog(text, level = "info") {
  queueLogEntry(text, level);
}

export function clearTerminalLogs() {
  const containers = [
    document.getElementById("terminal-logs"),
    document.getElementById("terminal-page-logs")
  ].filter(Boolean);

  containers.forEach(c => c.innerHTML = "");
  pendingBuffer = [];
}

export function setTerminalFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll(".terminal-pill-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });
  applyFiltersToExistingLogs();
}

export function filterTerminalSearch(query) {
  activeSearch = (query || "").trim().toLowerCase();
  applyFiltersToExistingLogs();
}

export function toggleTerminalPause() {
  isPaused = !isPaused;
  const pauseBtns = document.querySelectorAll(".btn-terminal-pause");
  pauseBtns.forEach(b => {
    b.innerText = isPaused ? "▶ Resume" : "⏸ Pause";
    b.classList.toggle("active", isPaused);
  });
}

function applyFiltersToExistingLogs() {
  const lines = document.querySelectorAll(".terminal-body .log-line");
  lines.forEach(line => {
    const level = line.dataset.level || "info";
    const text = line.dataset.text || "";
    if (matchesFilters(level, text)) {
      line.classList.remove("log-hidden");
    } else {
      line.classList.add("log-hidden");
    }
  });
}

// Expose globally for inline button and filter handlers
window.setTerminalFilter = setTerminalFilter;
window.filterTerminalSearch = filterTerminalSearch;
window.toggleTerminalPause = toggleTerminalPause;
window.clearTerminalLogs = clearTerminalLogs;

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
