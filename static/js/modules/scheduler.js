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
      const isWithinHours = !isSunday && (hour >= 9 && hour < 17);

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
      } else if (isWithinHours) {
        opDot.className = "status-indicator-dot dot-active";
        opStateTitle.innerText = "Operational Window Open";
        if (opSubInfo) {
          const detail = data.next_task
            ? `Next: ${data.next_task.label} at ${data.next_task.scheduled_time.slice(11, 16)}`
            : "Tasks running in rotation";
          opSubInfo.innerText = detail;
        }
        if (opWidget) opWidget.setAttribute("data-title", "Window Open: 09:00 - 17:00 Active");
      } else {
        opDot.className = "status-indicator-dot dot-waiting";
        opStateTitle.innerText = "Outside Working Hours";
        if (opSubInfo) {
          opSubInfo.innerText = data.retry_at ? `Retry at ${data.retry_at}` : "Window resumes 09:00";
        }
        if (opWidget) opWidget.setAttribute("data-title", "Outside Window: Resumes Mon-Sat 09:00");
      }
    }
  } catch (err) {
    console.error("Failed to load scheduler status:", err);
  }
}
