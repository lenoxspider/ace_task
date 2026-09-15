/* ============================================================================
   Core — utilities, toast, modal manager, API client, preview-mode fallback
   Global namespace: window.Ace
   ========================================================================== */
(function () {
  "use strict";

  var Ace = window.Ace = window.Ace || {};

  /* ---------------- DOM helpers ---------------- */
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); return el; }

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ---------------- Formatting ---------------- */
  function money(v, withSign) {
    var n = Number(v || 0);
    var s = n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (withSign && n > 0 ? "+" : "") + s;
  }
  function num(v) {
    return Number(v || 0).toLocaleString("en-US");
  }
  function compact(v) {
    var n = Number(v || 0);
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(n);
  }
  function timeOnly(iso) {
    if (!iso) return new Date().toISOString().slice(11, 19);
    var d = new Date(String(iso).replace(" ", "T") + (String(iso).length <= 19 ? "Z" : ""));
    if (isNaN(d)) return String(iso).slice(11, 19) || "--:--:--";
    return d.toISOString().slice(11, 19);
  }
  function stamp(iso) {
    if (!iso) return "—";
    var d = new Date(String(iso).replace(" ", "T") + (String(iso).length <= 19 ? "Z" : ""));
    if (isNaN(d)) return String(iso);
    return d.toISOString().slice(0, 16).replace("T", " ") + "Z";
  }
  function gmtClock() {
    return new Date().toISOString().slice(11, 19) + " GMT";
  }
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  /* ---------------- Status semantics ---------------- */
  function statusTone(status) {
    var s = String(status || "").toLowerCase();
    if (!s) return "dim";
    if (s.indexOf("paused") > -1) return "warn";
    if (s.indexOf("running") > -1) return "info";
    if (s.indexOf("complet") > -1 || s.indexOf("verif") > -1 || s.indexOf("success") > -1) return "ok";
    if (s.indexOf("fail") > -1 || s.indexOf("error") > -1 || s.indexOf("reject") > -1) return "err";
    return "dim";
  }
  function toneBadge(tone) {
    return tone === "ok" ? "badge--ok" : tone === "warn" ? "badge--warn" :
      tone === "err" ? "badge--err" : tone === "info" ? "badge--info" : "";
  }

  /* ---------------- Toast ---------------- */
  var ICONS = { ok: "checkcircle", warn: "alert", err: "xcircle", info: "info" };
  function mountToasts() {
    var host = qs("#toasts");
    if (!host) { host = document.createElement("div"); host.id = "toasts"; host.className = "toasts"; document.body.appendChild(host); }
    return host;
  }
  function toast(title, message, tone, ms) {
    tone = tone || "info"; ms = ms || (tone === "err" ? 6500 : 4200);
    var host = mountToasts();
    var el = document.createElement("div");
    el.className = "toast toast--" + tone;
    el.setAttribute("role", tone === "err" ? "alert" : "status");
    el.innerHTML =
      Ace.icon(ICONS[tone] || "info", 16) +
      '<div><div class="toast__title">' + esc(title) + '</div>' +
      (message ? '<div class="toast__msg">' + esc(message) + '</div>' : "") + '</div>' +
      '<button class="toast__close" aria-label="Dismiss">' + Ace.icon("close", 13) + '</button>';
    host.appendChild(el);
    var t = setTimeout(dismiss, ms);
    function dismiss() {
      clearTimeout(t);
      el.classList.add("is-out");
      setTimeout(function () { el.remove(); }, 220);
    }
    el.querySelector(".toast__close").addEventListener("click", dismiss);
    return el;
  }

  /* ---------------- Modal manager ---------------- */
  var Modal = {
    open: function (id) {
      var m = document.getElementById(id);
      if (!m) return null;
      m.dataset.open = "true";
      document.body.style.overflow = "hidden";
      var f = m.querySelector("input,select,textarea,button");
      if (f) setTimeout(function () { try { f.focus(); } catch (e) {} }, 40);
      return m;
    },
    close: function (id) {
      var m = document.getElementById(id);
      if (!m) return;
      m.dataset.open = "false";
      if (!qsa('.modal[data-open="true"]').length) document.body.style.overflow = "";
    },
    closeAll: function () {
      qsa('.modal[data-open="true"]').forEach(function (m) { m.dataset.open = "false"; });
      document.body.style.overflow = "";
    },
    init: function () {
      qsa(".modal").forEach(function (m) {
        var scrim = m.querySelector(".modal__scrim");
        if (scrim) scrim.addEventListener("click", function () { Modal.close(m.id); });
        qsa("[data-close]", m).forEach(function (b) {
          b.addEventListener("click", function () { Modal.close(m.id); });
        });
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") Modal.closeAll();
      });
    }
  };

  /* ---------------- State ---------------- */
  var state = {
    accounts: [],
    runningIds: {},
    preview: false,
    offline: false,
    page: document.body.dataset.page || "overview"
  };
  function setAccounts(list) { state.accounts = Array.isArray(list) ? list : []; }
  function accountById(id) { return state.accounts.filter(function (a) { return a.id === Number(id); })[0]; }
  function isRunning(id) { return !!state.runningIds[Number(id)]; }

  /* ---------------- API client ---------------- */
  var API_BASE = "";
  function loginUrl() { return /\.html?$/i.test(location.pathname) ? "login.html" : "/login"; }
  function isPreviewForced() {
    return location.protocol === "file:" || /[?&]preview=1/.test(location.search);
  }
  function enablePreview(reason) {
    if (state.preview) return;
    state.preview = true;
    var strip = qs("#preview-strip");
    if (strip) {
      strip.dataset.show = "true";
      var t = strip.querySelector("[data-preview-text]");
      if (t) t.textContent = reason || "Sample data — connect the app server to see live data.";
    }
  }

  function raw(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    if (opts.body) headers["Content-Type"] = "application/json";
    var token = localStorage.getItem("ace_token");
    if (token) headers["X-Session-Token"] = token;
    return fetch(API_BASE + path, Object.assign({}, opts, { headers: headers, credentials: "same-origin" }))
      .then(function (res) {
        if (res.status === 401 && path.indexOf("/api/auth") === -1) {
          try { localStorage.removeItem("ace_token"); } catch (e) {}
          location.href = loginUrl();
          throw new Error("Session expired");
        }
        return res;
      });
  }

  function json(path, opts) {
    if (isPreviewForced()) return Promise.reject({ preview: true });
    return raw(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var msg = (data && (data.detail || data.message)) || ("HTTP " + res.status);
          var httpErr = new Error(msg);
          httpErr.status = res.status;      // relied on by safe() to spot a missing endpoint
          throw httpErr;
        }
        return data;
      });
    });
  }

  // Empty payloads used when the server cannot be reached. A real deployment must NEVER
  // show invented accounts or balances, so an outage surfaces as an obvious error plus
  // empty data - never as convincing-looking sample numbers.
  var EMPTY = {
    accounts: [],
    history: [],
    analytics: [],
    plan: { windows: [], problems: [], skipped: [] },
    queue: { queue: [] },
    stats: {},
    scheduled: null,
    settings: {},
    version: {},
    withdrawalOptions: {}
  };

  function emptyFor(key) {
    return EMPTY[key] !== undefined ? EMPTY[key] : [];
  }

  function offlineError(message) {
    state.offline = true;
    try {
      var bar = qs("#offline-strip");
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "offline-strip";
        bar.setAttribute("role", "alert");
        bar.style.cssText = "position:sticky;top:0;z-index:9999;background:#7f1d1d;color:#fff;" +
          "padding:8px 14px;font:600 13px/1.45 var(--font-mono, monospace);text-align:center;";
        bar.innerHTML = "<span data-offline-text></span>";
        var host = document.body || document.documentElement;
        host.insertBefore(bar, host.firstChild);
      }
      var t = bar.querySelector("[data-offline-text]");
      if (t) t.textContent = message + " Showing empty values - this is NOT live data.";
    } catch (e) { /* the banner must never break the page */ }
  }

  function safe(path, demoKey, opts) {
    return json(path, opts).catch(function (err) {
      // Sample data is only for explicit preview mode (file:// or ?preview=1).
      if (err && err.preview) { enablePreview(); return demo(demoKey || path); }
      var unreachable = err && err.name === "TypeError";
      var missing = err && (err.status === 404 || err.status === 405 || err.status === 501
        || /HTTP (404|405|501)/.test(String(err.message)));
      if (unreachable || missing) {
        offlineError(unreachable
          ? "Cannot reach the app server."
          : "Endpoint unavailable (" + err.message + ") - the server may be running an older build.");
        return emptyFor(demoKey || path);
      }
      throw err;
    });
  }

  function post(path, body) { return json(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }); }
  function put(path, body) { return json(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }); }
  function del(path) { return json(path, { method: "DELETE" }); }

  /* ---------------- Demo dataset (preview only) ---------------- */
  var DEMO = {
    accounts: [
      { id: 1, phone: "502931744", label: "GT-Accra-01", mode: "api", enabled: 1, vip_level: "VIP4", balance: "412.50", earned_today: 68.4, tasks_done_today: 12, total_tasks_done: 1480, total_earned_ghs: 6120.4, last_status: "Completed", auto_withdraw: 1, withdraw_amount: 170, last_withdraw_date: todayStr(), effective_window: "04:00-08:00", window_source: "account" },
      { id: 2, phone: "509112038", label: "Kumasi-Runner", mode: "api", enabled: 1, vip_level: "VIP2", balance: "88.00", earned_today: 24.6, tasks_done_today: 6, total_tasks_done: 640, total_earned_ghs: 2410.0, last_status: "Running...", auto_withdraw: 0, withdraw_amount: 0, effective_window: "04:00-08:00", window_source: "default" },
      { id: 3, phone: "554008821", label: "Takoradi-02", mode: "browser", enabled: 0, vip_level: "VIP1", balance: "12.00", earned_today: 0, tasks_done_today: 0, total_tasks_done: 210, total_earned_ghs: 780.5, last_status: "Paused", auto_withdraw: 0, withdraw_amount: 0, effective_window: "05:00-09:00", window_source: "account" },
      { id: 4, phone: "551120776", label: "Main-Account", mode: "api", enabled: 1, vip_level: "VIP5", balance: "1,204.75", earned_today: 132.5, tasks_done_today: 20, total_tasks_done: 3020, total_earned_ghs: 14980.9, last_status: "Verified", auto_withdraw: 1, withdraw_amount: 525, last_withdraw_date: "", effective_window: "03:30-07:30", window_source: "account" },
      { id: 5, phone: "507771204", label: "Tamale-Node", mode: "api", enabled: 1, vip_level: "VIP3", balance: "203.10", earned_today: 41.2, tasks_done_today: 9, total_tasks_done: 905, total_earned_ghs: 3980.2, last_status: "Failed (auth)", auto_withdraw: 1, withdraw_amount: 65, last_withdraw_date: "", effective_window: "04:00-08:00", window_source: "default" }
    ],
    stats: { total_accounts: 5, active_accounts: 4, tasks_completed_today: 47, total_earned_today: 266.7, lifetime_tasks: 6255, lifetime_earned: 28272.0 },
    analytics: [
      { date: "2026-09-09", label: "Wed (09)", tasks: 41, earned: 210.4 },
      { date: "2026-09-10", label: "Thu (10)", tasks: 46, earned: 238.9 },
      { date: "2026-09-11", label: "Fri (11)", tasks: 52, earned: 291.2 },
      { date: "2026-09-12", label: "Sat (12)", tasks: 44, earned: 226.0 },
      { date: "2026-09-13", label: "Sun (13)", tasks: 0, earned: 0 },
      { date: "2026-09-14", label: "Mon (14)", tasks: 49, earned: 254.8 },
      { date: "2026-09-15", label: "Tue (15)", tasks: 47, earned: 266.7 }
    ],
    scheduled: { enabled: true, status_text: "Active", next_task: { label: "Tamale-Node", scheduled_time: "2026-09-15T04:00:00Z" }, retry_at: null },
    active: { running_ids: [2], is_batch_running: false },
    history: [
      { id: 1, account_id: 4, phone: "551120776", label: "Main-Account", run_time: "2026-09-15 06:12:44", status: "Completed", tasks_done: 20, earned: 132.5, balance: "1204.75" },
      { id: 2, account_id: 1, phone: "502931744", label: "GT-Accra-01", run_time: "2026-09-15 05:48:10", status: "Completed", tasks_done: 12, earned: 68.4, balance: "412.50" },
      { id: 3, account_id: 5, phone: "507771204", label: "Tamale-Node", run_time: "2026-09-15 05:21:03", status: "Failed", tasks_done: 0, earned: 0, balance: "203.10" },
      { id: 4, account_id: 2, phone: "509112038", label: "Kumasi-Runner", run_time: "2026-09-15 04:57:36", status: "Completed", tasks_done: 6, earned: 24.6, balance: "88.00" },
      { id: 5, account_id: 4, phone: "551120776", label: "Main-Account", run_time: "2026-09-14 06:09:12", status: "Completed", tasks_done: 19, earned: 126.0, balance: "1072.25" }
    ],
    queue: {
      queue: [
        { id: 12, account_id: 4, phone: "551120776", label: "Main-Account", amount: 525, status: "queued", scheduled_for: "2026-09-15 09:34:00", result_message: "Awaiting window slot" },
        { id: 11, account_id: 1, phone: "502931744", label: "GT-Accra-01", amount: 170, status: "processing", scheduled_for: "2026-09-15 09:08:00", result_message: "Submitting to MoMo" }
      ],
      min_spacing: 25, max_spacing: 50, window: "09:00 - 17:00 (Mon - Fri)"
    },
    settings: {
      telegram_token: "8447722246:AAG9****", telegram_chat_id: "5511238401", base_url: "https://ace775.com",
      schedule_time: "09:00", schedule_enabled: "1", auto_retry_outside_hours: "1", retry_interval_minutes: "30",
      min_withdrawal_spacing_minutes: "25", max_withdrawal_spacing_minutes: "50",
      midnight_scheduler_enabled: "1", min_task_spacing_minutes: "15", max_task_spacing_minutes: "35",
      default_window_start: "04:00", default_window_end: "08:00", slot_duration_minutes: "10",
      missed_window_policy: "late", late_run_cutoff: "23:00"
    },
    version: { branch: "main", commit: "9f3c1ab", subject: "Tune withdrawal pacing bounds", date: "2026-09-14 21:40", ahead: 0, behind: 0, dirty: false },
    plan: {
      windows: [
        { window: "03:30 - 07:30", accounts: [{ id: 4, label: "Main-Account", window_source: "account", slot: "03:30", late: false }], capacity: 15, count: 1, ok: true },
        { window: "04:00 - 08:00", accounts: [{ id: 1, label: "GT-Accra-01", window_source: "account", slot: "04:00", late: false }, { id: 2, label: "Kumasi-Runner", window_source: "default", slot: "04:15", late: false }, { id: 5, label: "Tamale-Node", window_source: "default", slot: "04:30", late: false }], capacity: 15, count: 3, ok: true },
        { window: "05:00 - 09:00", accounts: [{ id: 3, label: "Takoradi-02", window_source: "account", slot: null, late: false }], capacity: 15, count: 1, ok: true }
      ],
      problems: [], skipped: [], spacing_minutes: 15, slot_duration_minutes: 10, late_run_cutoff: "23:00", missed_window_policy: "late"
    },
    withdrawalOptions: { ok: true, min_amount: 65, withdrawal_amounts: [65, 170, 525, 1600, 4500, 14000, 33500, 65000, 150000, 200000, 500000, 1000000], withdrawal_fee: 0, income_balance: 412.5, personal_balance: 0, configured_withdraw_amount: 170 }
  };

  function demo(key) {
    if (!key) return DEMO;
    return DEMO[key] !== undefined ? DEMO[key] : null;
  }

  /* ---------------- Busy button helper ---------------- */
  function busy(btn, on) {
    if (!btn) return;
    btn.classList.toggle("is-busy", !!on);
    btn.disabled = !!on;
  }

  Ace.qs = qs; Ace.qsa = qsa; Ace.on = on;
  Ace.esc = esc;
  Ace.money = money; Ace.num = num; Ace.compact = compact;
  Ace.timeOnly = timeOnly; Ace.stamp = stamp; Ace.gmtClock = gmtClock; Ace.todayStr = todayStr;
  Ace.statusTone = statusTone; Ace.toneBadge = toneBadge;
  Ace.toast = toast;
  Ace.Modal = Modal;
  Ace.state = state; Ace.setAccounts = setAccounts; Ace.accountById = accountById; Ace.isRunning = isRunning;
  Ace.api = { raw: raw, json: json, safe: safe, post: post, put: put, del: del, base: API_BASE };
  Ace.demo = demo;
  Ace.busy = busy;
  Ace.enablePreview = enablePreview;
})();
