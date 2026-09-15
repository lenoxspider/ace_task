/**
 * Ace775 Command Center - API Client Module
 */

export async function request(endpoint, options = {}) {
  const defaultHeaders = {
    "Accept": "application/json"
  };

  if (options.body && typeof options.body === "string") {
    defaultHeaders["Content-Type"] = "application/json";
  }

  const token = localStorage.getItem("ace_session_token");
  if (token) {
    defaultHeaders["X-Session-Token"] = token;
  }

  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...(options.headers || {})
    }
  };

  const res = await fetch(endpoint, config);

  if (res.status === 401 && !endpoint.includes("/api/auth")) {
    localStorage.removeItem("ace_session_token");
    window.location.href = "/login";
    throw new Error("Session expired. Please log in again.");
  }

  return res;
}

export const api = {
  getAccounts: async () => {
    const res = await request("/api/accounts");
    if (!res.ok) throw new Error("Failed to load accounts");
    return res.json();
  },

  togglePause: async (accountId) => {
    const res = await request(`/api/accounts/${accountId}/toggle-pause`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.message || "Failed to toggle pause");
    return data;
  },

  runAccount: async (accountId) => {
    const res = await request(`/api/accounts/${accountId}/run`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.detail || "Failed to start run");
    return data;
  },

  runAll: async () => {
    const res = await request("/api/run-all", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.detail || "Failed to start batch execution");
    return data;
  },

  refreshBalance: async (accountId) => {
    const res = await request(`/api/accounts/${accountId}/refresh-balance`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.message || "Refresh balance failed");
    return data;
  },

  getWithdrawalOptions: async (accountId, refresh = false) => {
    const res = await request(`/api/accounts/${accountId}/withdrawal-options${refresh ? '?refresh=true' : ''}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.message || "Failed to fetch withdrawal options");
    return data;
  },

  verifyLogin: async (payload) => {
    const res = await request("/api/accounts/verify", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Verification rejected");
    return data;
  },

  saveAccount: async (id, payload) => {
    const url = id ? `/api/accounts/${id}` : "/api/accounts";
    const method = id ? "PUT" : "POST";
    const res = await request(url, {
      method: method,
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Save account failed");
    return data;
  },

  deleteAccount: async (accountId) => {
    const res = await request(`/api/accounts/${accountId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete account");
    return res.json();
  },

  getStats: async () => {
    const res = await request("/api/stats");
    if (!res.ok) return null;
    return res.json();
  },

  getAnalytics: async () => {
    const res = await request("/api/analytics/7days");
    if (!res.ok) return [];
    return res.json();
  },

  getScheduler: async () => {
    const res = await request("/api/scheduler");
    if (!res.ok) return null;
    return res.json();
  },

  getSettings: async () => {
    const res = await request("/api/settings");
    if (!res.ok) throw new Error("Failed to load settings");
    return res.json();
  },

  saveSettings: async (payload) => {
    const res = await request("/api/settings", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Failed to save settings");
    return res.json();
  },

  testTelegram: async (payload) => {
    const res = await request("/api/settings/test-telegram", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || "Failed to test Telegram notification");
    }
    return res.json();
  },

  getHistory: async (accountId = null) => {
    const url = accountId ? `/api/history?account_id=${accountId}` : "/api/history";
    const res = await request(url);
    if (!res.ok) throw new Error("Failed to load history records");
    return res.json();
  },

  submitWithdrawal: async (accountId, payload) => {
    const res = await request(`/api/accounts/${accountId}/withdraw`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.message || "Withdrawal failed");
    return data;
  },

  getWithdrawalQueue: async () => {
    const res = await request("/api/withdrawals/queue");
    if (!res.ok) return { queue: [] };
    return res.json();
  },

  cancelWithdrawalQueue: async (queueId) => {
    const res = await request(`/api/withdrawals/queue/${queueId}/cancel`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to cancel queued withdrawal");
    return data;
  },

  enqueueWithdrawal: async (accountId, payload) => {
    const res = await request(`/api/accounts/${accountId}/enqueue-withdrawal`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.message || "Failed to queue withdrawal");
    return data;
  },

  importCsv: async (csvContent) => {
    const res = await request("/api/accounts/import", {
      method: "POST",
      body: JSON.stringify({ csv_content: csvContent })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "CSV import failed");
    return data;
  },

  getSystemVersion: async (check = false) => {
    const res = await request(`/api/system/version${check ? "?check=true" : ""}`);
    if (!res.ok) throw new Error("Failed to read the installed version");
    return res.json();
  },

  runSystemUpdate: async (payload) => {
    const res = await request("/api/system/update", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Update failed");
    return data;
  },

  getWindowsPlan: async () => {
    const res = await request("/api/windows/plan");
    if (!res.ok) throw new Error("Failed to load the window plan");
    return res.json();
  },

  logout: async () => {
    try {
      await request("/api/auth/logout", { method: "POST" });
    } catch (e) {}
    localStorage.removeItem("ace_session_token");
    window.location.href = "/login";
  }
};
