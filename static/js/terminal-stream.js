/* ============================================================================
   Terminal stream — shared SSE console engine
   Attaches to a .terminal container and renders filtered, batched log lines.
   ========================================================================== */
(function () {
  "use strict";
  var Ace = window.Ace;
  var esc = Ace.esc;

  var LINE_LEVELS = {
    ok: ["[SUCCESS]", "completed", "verified", "refreshed", "saved"],
    warn: ["[WARNING]", "outside working hours", "retry", "paused", "queued"],
    err: ["[ERROR]", "failed", "error", "invalid", "rejected"]
  };

  function classify(text) {
    var s = String(text).toLowerCase();
    var i;
    for (i = 0; i < LINE_LEVELS.err.length; i++) if (s.indexOf(LINE_LEVELS.err[i]) > -1) return "error";
    for (i = 0; i < LINE_LEVELS.warn.length; i++) if (s.indexOf(LINE_LEVELS.warn[i]) > -1) return "warning";
    for (i = 0; i < LINE_LEVELS.ok.length; i++) if (s.indexOf(LINE_LEVELS.ok[i]) > -1) return "success";
    return "info";
  }

  function attach(opts) {
    opts = opts || {};
    var container = typeof opts.container === "string" ? Ace.qs(opts.container) : opts.container;
    if (!container) return null;

    var filter = "all";
    var search = "";
    var paused = false;
    var pending = [];
    var scheduled = false;
    var es = null;
    var demoTimer = null;
    var MAX = 400;

    function matches(level, text) {
      if (filter !== "all" && level !== filter) return false;
      if (search && String(text).toLowerCase().indexOf(search) === -1) return false;
      return true;
    }

    function makeLine(text, level, time) {
      var el = document.createElement("div");
      el.className = "termline termline--" + level;
      el.dataset.level = level;
      el.dataset.text = String(text).toLowerCase();
      if (!matches(level, text)) el.dataset.hidden = "true";
      el.innerHTML = '<span class="termline__time">' + esc(time) + '</span>' +
        '<span class="termline__level">' + esc(level) + '</span>' +
        '<span class="termline__text">' + esc(text) + '</span>';
      return el;
    }

    function flush() {
      scheduled = false;
      var items = pending.splice(0, pending.length);
      if (!items.length) return;
      var frag = document.createDocumentFragment();
      items.forEach(function (it) { frag.appendChild(makeLine(it.text, it.level, it.time)); });
      container.appendChild(frag);
      while (container.childNodes.length > MAX) container.removeChild(container.firstChild);
      if (!paused) container.scrollTop = container.scrollHeight;
    }

    function push(text, level) {
      if (!text) return;
      pending.push({ text: text, level: level || classify(text), time: Ace.timeOnly() });
      if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
    }

    function connect() {
      if (Ace.state.preview) { startDemo(); return; }
      try { es = new EventSource("/api/logs/stream"); } catch (e) { startDemo(); return; }
      es.onmessage = function (ev) {
        if (!ev.data || ev.data.indexOf("ping") > -1) return;
        var raw = ev.data;
        var m = raw.match(/\[ACCOUNT_RUNNING:(\d+)\]/);
        if (m) { Ace.state.runningIds[Number(m[1])] = true; if (opts.onAccountState) opts.onAccountState(true); return; }
        m = raw.match(/\[ACCOUNT_IDLE:(\d+)\]/);
        if (m) { delete Ace.state.runningIds[Number(m[1])]; if (opts.onAccountState) opts.onAccountState(true); return; }
        // strip "timestamp [LEVEL] " prefix if present; keep message readable
        push(raw);
      };
      es.onerror = function () { /* EventSource auto-reconnects; fall back if it hard-fails */
        if (es && es.readyState === 2) { startDemo(); }
      };
    }

    function startDemo() {
      if (demoTimer) return;
      var seed = [
        "[SYSTEM] Preview stream — sample telemetry (server offline).",
        "[COMMAND] Batch execution started for 4 active accounts.",
        "[GT-Accra-01] Logged in · VIP4 · balance 412.50 GHS",
        "[GT-Accra-01] Claimed 12 daily tasks · earned +68.40 GHS",
        "[Kumasi-Runner] Outside working hours — retry scheduled in 30 min",
        "[Main-Account] Verified · 20 tasks · earned +132.50 GHS",
        "[Tamale-Node] ERROR authentication failed: session expired",
        "[Withdrawal Queue] 'Main-Account' queued for 525.00 GHS at 09:34",
        "[SYSTEM] Next slot in 15 min · pacing 15–35 min"
      ];
      var i = 0;
      demoTimer = setInterval(function () {
        push(seed[i % seed.length]);
        i++;
        if (i > seed.length * 2) { clearInterval(demoTimer); demoTimer = null; }
      }, 1400);
    }

    function applyToExisting() {
      Ace.qsa(".termline", container).forEach(function (l) {
        l.dataset.hidden = matches(l.dataset.level || "info", l.dataset.text || "") ? "false" : "true";
      });
    }

    var handle = {
      push: push,
      clear: function () { container.innerHTML = ""; pending = []; },
      setFilter: function (f) { filter = f; applyToExisting(); },
      setSearch: function (s) { search = String(s || "").trim().toLowerCase(); applyToExisting(); },
      togglePause: function (on) { paused = (on === undefined ? !paused : !!on); return paused; },
      isPaused: function () { return paused; },
      isPreview: function () { return !!demoTimer; },
      destroy: function () { if (es) es.close(); if (demoTimer) clearInterval(demoTimer); }
    };

    connect();
    return handle;
  }

  Ace.stream = { attach: attach, classify: classify };
})();
