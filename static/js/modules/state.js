/**
 * Ace775 Command Center - Central Application State
 */

export const state = {
  accounts: [],
  runningAccountIds: new Set(),
  stats: null,
  activeFilter: "all", // 'all' | 'active' | 'paused' | 'running'
  searchQuery: "",
  eventSource: null
};

export function setAccounts(newAccounts) {
  state.accounts = newAccounts || [];
}

export function getAccountById(id) {
  return state.accounts.find(a => a.id === Number(id));
}

export function isAccountRunning(id) {
  const acc = getAccountById(id);
  return state.runningAccountIds.has(Number(id)) || (acc && acc.last_status === "Running...");
}

export function isAccountPaused(acc) {
  return acc && acc.enabled === 0;
}

export function getCounts() {
  const all = state.accounts.length;
  const paused = state.accounts.filter(a => a.enabled === 0).length;
  const active = state.accounts.filter(a => a.enabled === 1).length;
  const running = state.accounts.filter(a => isAccountRunning(a.id)).length;
  return { all, active, paused, running };
}

export function getFilteredAccounts() {
  const q = state.searchQuery.toLowerCase().trim();
  const filter = state.activeFilter;

  return state.accounts.filter(acc => {
    // 1. Text Search Filter
    if (q) {
      const matchPhone = acc.phone && acc.phone.toLowerCase().includes(q);
      const matchLabel = acc.label && acc.label.toLowerCase().includes(q);
      if (!matchPhone && !matchLabel) return false;
    }

    // 2. Status Tab Filter
    if (filter === "active") {
      return acc.enabled === 1;
    }
    if (filter === "paused") {
      return acc.enabled === 0;
    }
    if (filter === "running") {
      return isAccountRunning(acc.id);
    }

    return true; // 'all'
  });
}
