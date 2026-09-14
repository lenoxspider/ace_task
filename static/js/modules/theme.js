/**
 * Ace775 Command Center - Theme & Accessibility Management Module
 * Supports Dark, Light, and High-Contrast modes with a clean segmented control.
 */

export function initTheme() {
  const savedTheme = localStorage.getItem("ace_theme") || "dark";
  const savedHC = localStorage.getItem("ace_high_contrast") === "true";

  document.documentElement.setAttribute("data-theme", savedTheme);
  if (savedHC) {
    document.documentElement.setAttribute("data-high-contrast", "true");
    document.body.classList.add("high-contrast");
  } else {
    document.documentElement.removeAttribute("data-high-contrast");
    document.body.classList.remove("high-contrast");
  }

  updateSegmentedControl(savedTheme, savedHC);
}

export function setThemeMode(mode) {
  if (mode === "hc") {
    // Toggle or enable high contrast on current theme
    const isHC = document.documentElement.getAttribute("data-high-contrast") === "true";
    const nextHC = !isHC;
    if (nextHC) {
      document.documentElement.setAttribute("data-high-contrast", "true");
      document.body.classList.add("high-contrast");
      localStorage.setItem("ace_high_contrast", "true");
      if (window.showToast) window.showToast("High Contrast Mode", "Maximum contrast enabled for accessibility.", "info");
    } else {
      document.documentElement.removeAttribute("data-high-contrast");
      document.body.classList.remove("high-contrast");
      localStorage.setItem("ace_high_contrast", "false");
      if (window.showToast) window.showToast("Standard Mode", "Standard color contrast restored.", "info");
    }
  } else {
    // Switch between dark and light
    document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem("ace_theme", mode);
  }

  const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
  const isHC = document.documentElement.getAttribute("data-high-contrast") === "true";
  updateSegmentedControl(currentTheme, isHC);
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  setThemeMode(next);
}

export function toggleHighContrast() {
  setThemeMode("hc");
}

function updateSegmentedControl(theme, isHC) {
  const btnDark = document.getElementById("theme-btn-dark");
  const btnLight = document.getElementById("theme-btn-light");
  const btnHC = document.getElementById("theme-btn-hc");

  if (btnDark) btnDark.classList.toggle("active", theme === "dark" && !isHC);
  if (btnLight) btnLight.classList.toggle("active", theme === "light" && !isHC);
  if (btnHC) {
    btnHC.classList.toggle("active", isHC);
    btnHC.setAttribute("aria-pressed", isHC ? "true" : "false");
  }
}

window.setThemeMode = setThemeMode;
window.toggleTheme = toggleTheme;
window.toggleHighContrast = toggleHighContrast;
