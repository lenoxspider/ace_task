/**
 * Ace775 Command Center - Auto-Scheduler Status Module
 */

import { api } from "./api.js";

export async function loadSchedulerStatus() {
  try {
    const data = await api.getScheduler();
    if (!data) return;

    const pill = document.getElementById("header-scheduler-badge");
    const text = document.getElementById("header-scheduler-text");

    if (pill && text) {
      if (data.enabled) {
        pill.classList.remove("disabled");
        text.innerText = `Scheduler: ${data.status_text}`;
      } else {
        pill.classList.add("disabled");
        text.innerText = "Scheduler: Disabled";
      }
    }
  } catch (err) {
    console.error("Failed to load scheduler status:", err);
  }
}
