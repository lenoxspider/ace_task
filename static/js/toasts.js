/**
 * Ace775 Command Center - Rich Toast Notification System
 * One system, 4 tones (success, warning, error, info).
 * Features auto-dismiss, hover pause, and accessible roles.
 */

export function showToast(title, message = "", type = "info", duration = 4500) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const icons = {
    success: "✓",
    warning: "⚠",
    error: "✕",
    info: "ⓘ"
  };

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.setAttribute("aria-live", type === "error" ? "assertive" : "polite");

  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || "ⓘ"}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeToast(title)}</div>
      ${message ? `<div class="toast-message">${escapeToast(message)}</div>` : ""}
    </div>
    <button class="toast-close" aria-label="Close notification">&times;</button>
    <div class="toast-progress"></div>
  `;

  container.appendChild(toast);

  // Trigger entry animation
  requestAnimationFrame(() => {
    toast.classList.add("toast-show");
  });

  const progressBar = toast.querySelector(".toast-progress");
  let startTime = Date.now();
  let remaining = type === "error" ? Math.max(duration, 6000) : duration;
  let timerId = null;
  let animFrameId = null;

  function updateProgress() {
    const elapsed = Date.now() - startTime;
    const progress = Math.max(0, 1 - (elapsed / remaining));
    if (progressBar) {
      progressBar.style.transform = `scaleX(${progress})`;
    }
    if (progress > 0) {
      animFrameId = requestAnimationFrame(updateProgress);
    }
  }

  function startDismiss() {
    startTime = Date.now();
    timerId = setTimeout(dismiss, remaining);
    animFrameId = requestAnimationFrame(updateProgress);
  }

  function pauseDismiss() {
    clearTimeout(timerId);
    cancelAnimationFrame(animFrameId);
    remaining -= (Date.now() - startTime);
  }

  function dismiss() {
    clearTimeout(timerId);
    cancelAnimationFrame(animFrameId);
    toast.classList.remove("toast-show");
    toast.classList.add("toast-hide");
    setTimeout(() => {
      toast.remove();
    }, 350);
  }

  toast.querySelector(".toast-close").onclick = dismiss;
  toast.addEventListener("mouseenter", pauseDismiss);
  toast.addEventListener("mouseleave", () => {
    if (remaining > 0) startDismiss();
  });

  startDismiss();
}

function escapeToast(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

window.showToast = showToast;
