/**
 * Ace775 Command Center - Metrics & Statistics Module
 */

import { api } from "./api.js";

export async function loadStats() {
  try {
    const stats = await api.getStats();
    if (!stats) return;

    const elTotal = document.getElementById("stat-total-accounts");
    const elActive = document.getElementById("stat-active-subtitle");
    const elTasks = document.getElementById("stat-tasks-today");
    const elEarned = document.getElementById("stat-earned-today");

    if (elTotal) elTotal.innerText = stats.total_accounts;
    if (elActive) elActive.innerText = `${stats.active_accounts} active in rotation`;
    if (elTasks) elTasks.innerText = stats.tasks_completed_today;
    if (elEarned) elEarned.innerHTML = `${stats.total_earned_today.toFixed(2)} <span class="currency">GHS</span>`;

    // Lifetime Footers
    const cards = document.querySelectorAll("#stats-section .stat-card");
    if (cards.length >= 3) {
      if (stats.lifetime_tasks !== undefined) {
        cards[1].querySelector(".stat-footer").innerText = `Today • Lifetime: ${stats.lifetime_tasks} tasks`;
      }
      if (stats.lifetime_earned !== undefined) {
        cards[2].querySelector(".stat-footer").innerText = `Today • Lifetime: ${stats.lifetime_earned.toFixed(2)} GHS`;
      }
    }
  } catch (err) {
    console.error("Failed to load dashboard stats:", err);
  }
}
