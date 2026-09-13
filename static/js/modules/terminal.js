/**
 * Ace775 Command Center - Live Automation Terminal Console Module
 */

import { state } from "./state.js";

export function initTerminal(onAccountStateChange) {
  if (state.eventSource) {
    state.eventSource.close();
  }

  state.eventSource = new EventSource("/api/logs/stream");

  state.eventSource.onmessage = (event) => {
    if (!event.data || event.data.includes("ping")) return;
    const line = event.data;

    // Handle real-time account running indicators
    if (line.includes("[ACCOUNT_RUNNING:")) {
      const match = line.match(/\[ACCOUNT_RUNNING:(\d+)\]/);
      if (match) {
        state.runningAccountIds.add(Number(match[1]));
        if (onAccountStateChange) onAccountStateChange();
      }
      return;
    }

    if (line.includes("[ACCOUNT_IDLE:")) {
      const match = line.match(/\[ACCOUNT_IDLE:(\d+)\]/);
      if (match) {
        state.runningAccountIds.delete(Number(match[1]));
        if (onAccountStateChange) onAccountStateChange(true);
      }
      return;
    }

    // Determine level
    let level = "info";
    if (line.includes("[SUCCESS]") || line.includes("✅") || line.includes("🎉")) {
      level = "success";
    } else if (line.includes("[WARNING]") || line.includes("⚠️") || line.includes("⏳") || line.includes("⏸️")) {
      level = "warning";
    } else if (line.includes("[ERROR]") || line.includes("❌")) {
      level = "error";
    }

    appendTerminalLog(line, level);
  };

  state.eventSource.onerror = () => {
    // EventSource handles reconnection automatically
  };
}

export function appendTerminalLog(text, level = "info") {
  const containers = [
    document.getElementById("terminal-logs"),
    document.getElementById("terminal-page-logs")
  ].filter(Boolean);

  if (containers.length === 0) return;

  containers.forEach(container => {
    const el = document.createElement("div");
    el.className = `log-line log-${level}`;
    el.innerText = text;
    container.appendChild(el);

    const autoScroll = document.getElementById("chk-autoscroll");
    if (!autoScroll || autoScroll.checked) {
      container.scrollTop = container.scrollHeight;
    }
  });
}

export function clearTerminalLogs() {
  const containers = [
    document.getElementById("terminal-logs"),
    document.getElementById("terminal-page-logs")
  ].filter(Boolean);

  containers.forEach(c => c.innerHTML = "");
}
