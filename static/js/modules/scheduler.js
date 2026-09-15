/**
 * Ace775 Command Center - Auto-Scheduler Status Module
 */

import { api } from "./api.js?v=4.0";

export async function loadSchedulerStatus() {
  try {
    const data = await api.getScheduler();
    if (!data) return;

    // Backwards-compatible legacy badge if present
    const legacyPill = document.getElementById("header-scheduler-badge");
    const legacyText = document.getElementById("header-scheduler-text");
    if (legacyPill && legacyText) {
      if (data.enabled) {
        legacyPill.classList.remove("disabled");
        legacyText.innerText = `Scheduler: ${data.status_text}`;
      } else {
        legacyPill.classList.add("disabled");
        legacyText.innerText = "Scheduler: Disabled";
      }
    }

    // Prominent Operational Window Status Card
    const opWidget = document.getElementById("sidebar-op-widget");
    const opDot = document.getElementById("op-dot");
    const opStateTitle = document.getElementById("op-state-title");
    const opWindowHours = document.getElementById("op-window-hours");
    const opSubInfo = document.getElementById("op-sub-info");

    if (opDot && opStateTitle) {
      const now = new Date();
      const isSunday = now.getDay() === 0;
      const hour = now.getHours();
      // Tasks run Monday to Saturday at ANY hour. Only withdrawals are limited to
      // 09:00-17:00 (Mon-Fri), so there is no task window to be outside of.
      const isWeekday = !isSunday && now.getDay() !== 6;
      const isWithdrawWindow = isWeekday && hour >= 9 && hour < 17;

      if (isSunday) {
        opDot.className = "status-indicator-dot dot-closed";
        opStateTitle.innerText = "Sunday Rest Day";
        if (opSubInfo) opSubInfo.innerText = "Platform Closed (Rest Day)";
        if (opWidget) opWidget.setAttribute("data-title", "Sunday: Platform Closed (Rest Day)");
      } else if (!data.enabled) {
        opDot.className = "status-indicator-dot dot-closed";
        opStateTitle.innerText = "Automation Disabled";
        if (opSubInfo) opSubInfo.innerText = "Task scheduler paused";
        if (opWidget) opWidget.setAttribute("data-title", "Scheduler is disabled in Settings");
      } else {
        opDot.className = "status-indicator-dot dot-active";
        opStateTitle.innerText = "Tasks Open";
        if (opSubInfo) {
          if (data.next_task) {
            opSubInfo.innerText = `Next: ${data.next_task.label} at ${data.next_task.scheduled_time.slice(11, 16)}`;
          } else if (data.retry_at) {
            opSubInfo.innerText = `Retry queued at ${data.retry_at}`;
          } else {
            opSubInfo.innerText = isWithdrawWindow
              ? "Withdrawal window open (until 17:00)"
              : "Withdrawals: Mon-Fri 09:00-17:00";
          }
        }
        if (opWidget) {
          opWidget.setAttribute("data-title",
            `Tasks run Mon-Sat at any hour${isWithdrawWindow ? " - withdrawal window open" : ""}`);
        }
      }
    }
  } catch (err) {
    console.error("Failed to load scheduler status:", err);
  }
}
