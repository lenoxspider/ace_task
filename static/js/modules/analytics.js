/**
 * Ace775 Command Center - 7-Day Performance Analytics Module
 */

import { api } from "./api.js?v=4.0";

export async function loadAnalytics() {
  const container = document.getElementById("chart-container");
  if (!container) return;

  try {
    const days = await api.getAnalytics();

    if (!days || days.length === 0) {
      container.innerHTML = `<div class="empty-placeholder">No analytics data recorded yet.</div>`;
      return;
    }

    const maxEarned = Math.max(...days.map(d => d.earned), 10.0);

    container.innerHTML = days.map(d => {
      const heightPercent = Math.max(Math.round((d.earned / maxEarned) * 100), 4);
      return `
        <div class="chart-bar-group" title="${d.date}: ${d.earned} GHS (${d.tasks} tasks)">
          <span class="chart-bar-val">${d.earned > 0 ? '+' + d.earned : '0'}</span>
          <div class="chart-bar-wrapper">
            <div class="chart-bar-fill" style="height: ${heightPercent}%"></div>
          </div>
          <span class="chart-bar-label">${d.label}</span>
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error("Failed to load analytics:", err);
  }
}
