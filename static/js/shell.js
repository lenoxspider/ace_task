/* ============================================================================
   Shell — left rail, operations topbar, theme, auth, live status
   Every page calls Ace.shell.mount() once on DOM ready.
   ========================================================================== */
(function () {
  "use strict";
  var Ace = window.Ace;

  var PAGES = {
    overview:    { title: "Overview",     sub: "System vitals & 7-day earnings", file: "index.html",       route: "/" },
    accounts:    { title: "Accounts",     sub: "Credentials, limits & rotation", file: "accounts.html",    route: "/accounts" },
    terminal:    { title: "Live Terminal",sub: "Real-time execution stream",      file: "terminal.html",    route: "/terminal" },
    withdrawals: { title: "Withdrawals",  sub: "Payout queue & auto-rules",       file: "withdrawals.html", route: "/withdrawals" },
    history:     { title: "Audit History",sub: "Execution records & exports",     file: "history.html",     route: "/history" },
    settings:    { title: "Settings",     sub: "Scheduler, Telegram & system",    file: "settings.html",    route: "/settings" }
  };

  var NAV = [
    { group: "Operations", items: ["overview", "accounts", "terminal", "withdrawals"] },
    { group: "System", items: ["history", "settings"] }
  ];
  var NAV_ICON = { overview: "gauge", accounts: "users", terminal: "terminal", withdrawals: "cash", history: "scroll", settings: "settings" };

  function isFileMode() { return /\.html?$/i.test(location.pathname); }
  function link(page) { return isFileMode() ? PAGES[page].file : PAGES[page].route; }
  function route(path) { return isFileMode() ? path.replace(/^\//, "").replace("login", "login.html") : path; }
  var LS = {
    theme: "ace_theme", contrast: "ace_contrast", density: "ace_density", collapsed: "ace_rail_collapsed"
  };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  /* ---------------- Theme ---------------- */
  function applyTheme() {
    var theme = store(LS.theme) || "dark";
    var contrast = store(LS.contrast) === "true";
    var density = store(LS.density) || "compact";
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-contrast", contrast ? "high" : "normal");
    document.documentElement.setAttribute("data-density", density);
    reflectThemeButtons(theme, contrast, density);
  }
  function setTheme(theme) { store(LS.theme, theme); if (theme !== "dark" && theme !== "light") return; applyTheme(); }
  function toggleTheme() { setTheme((store(LS.theme) || "dark") === "dark" ? "light" : "dark"); }
  function toggleContrast() { store(LS.contrast, store(LS.contrast) === "true" ? "false" : "true"); applyTheme(); }
  function setDensity(d) { store(LS.density, d); applyTheme(); }

  function reflectThemeButtons(theme, contrast, density) {
    Ace.qsa("[data-theme-set]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.themeSet === theme && !contrast ? "true" : "false");
    });
    Ace.qsa("[data-contrast-toggle]").forEach(function (b) { b.setAttribute("aria-pressed", contrast ? "true" : "false"); });
    Ace.qsa("[data-density-set]").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.densitySet === density ? "true" : "false"); });
    var t = Ace.qs("[data-theme-icon]");
    if (t) t.innerHTML = Ace.icon(theme === "dark" ? "moon" : "sun", 16);
  }

  /* ---------------- Rail ---------------- */
  function railMarkup(active) {
    var navHtml = NAV.map(function (g) {
      return '<div class="navgroup"><div class="navgroup__title">' + g.group + '</div>' +
        g.items.map(function (p) {
          var badge = p === "accounts" ? '<span class="navitem__count" data-nav-count>0</span>' : "";
          var pulse = p === "terminal" ? '<span class="navitem__pulse" title="Live stream"></span>' : "";
          return '<a class="navitem" href="' + link(p) + '" data-nav="' + p + '"' +
            (p === active ? ' aria-current="page"' : "") + '>' +
            Ace.icon(NAV_ICON[p], 18) +
            '<span class="navitem__label">' + PAGES[p].title + '</span>' + pulse + badge + '</a>';
        }).join("") + '</div>';
    }).join("");

    return '' +
      '<div class="rail__brand">' +
        '<div class="rail__mark">' + Ace.icon("bolt", 20) + '</div>' +
        '<div class="rail__wordmark"><b>Ace775</b><span>Command Center</span></div>' +
        '<button class="rail__collapse" id="rail-collapse" title="Collapse rail (Ctrl+B)" aria-label="Collapse navigation">' + Ace.icon("chevronLeft", 15) + '</button>' +
      '</div>' +

      '<div class="opcard" id="opcard" title="Task status">' +
        '<div class="opcard__top"><span class="dot dot--off" id="op-dot"></span>' +
        '<span class="opcard__state" id="op-state">Checking status</span></div>' +
        '<span class="opcard__meta" id="op-window">Tasks Mon-Sat, any hour</span>' +
        '<span class="opcard__sub" id="op-sub">Scheduler: —</span>' +
      '</div>' +

      '<nav class="rail__nav" aria-label="Primary">' + navHtml + '</nav>' +

      '<div class="rail__foot">' +
        '<div class="seg" role="group" aria-label="Appearance">' +
          '<button data-theme-set="dark" aria-pressed="true" title="Dark">' + Ace.icon("moon", 14) + '<span>Dark</span></button>' +
          '<button data-theme-set="light" aria-pressed="false" title="Light">' + Ace.icon("sun", 14) + '<span>Light</span></button>' +
          '<button data-contrast-toggle aria-pressed="false" title="High contrast">' + Ace.icon("contrast", 14) + '<span>HC</span></button>' +
        '</div>' +
        '<div class="seg" role="group" aria-label="Density">' +
          '<button data-density-set="compact" aria-pressed="true" title="Compact">Compact</button>' +
          '<button data-density-set="comfortable" aria-pressed="false" title="Comfortable">Roomy</button>' +
        '</div>' +
        '<button class="btn btn--ghost btn--sm btn--block" id="btn-logout">' + Ace.icon("logout", 15) + 'Lock session</button>' +
        '<div class="rail__meta dim" style="font-size:var(--fs-micro);font-family:var(--font-mono);text-align:center;">ace-v4.0</div>' +
      '</div>';
  }

  /* ---------------- Topbar ---------------- */
  function topbarMarkup(page) {
    return '' +
      '<button class="topbar__menu" id="btn-drawer" aria-label="Open navigation">' + Ace.icon("menu", 18) + '</button>' +
      '<div class="row" style="gap:8px;min-width:0;">' +
        '<span class="eyebrow" style="color:var(--txt-3)">Ace775</span>' +
        '<span class="dim">/</span>' +
        '<b style="font-family:var(--font-display);font-size:var(--fs-sm);">' + PAGES[page].title + '</b>' +
      '</div>' +
      '<div class="topbar__spacer"></div>' +
      '<span class="statuschip" id="chip-status" title="Operational window">' + Ace.icon("activity", 14) + '<span id="chip-status-text">—</span></span>' +
      '<span class="statuschip" id="chip-link">' + Ace.icon("wifi", 14) + '<span data-link-text>Live</span></span>' +
      '<span class="statuschip" id="chip-batch" hidden>' + Ace.icon("activity", 14) + '<span>Batch running</span></span>' +
      '<span class="statuschip" title="Current time (GMT)">' + Ace.icon("clock", 14) + '<span class="mono" id="chip-clock">--:--:--</span></span>' +
      '<button class="iconbtn" id="btn-theme" title="Toggle theme" aria-label="Toggle theme"><span data-theme-icon></span></button>';
  }

  /* ---------------- Live status ---------------- */
  function loadScheduler() {
    return Ace.api.safe("/api/scheduler", "scheduled").then(function (d) {
      if (!d) return;
      var dot = Ace.qs("#op-dot"), state = Ace.qs("#op-state"), win = Ace.qs("#op-window"), sub = Ace.qs("#op-sub");
      if (!dot) return;
      var now = new Date();
      var sunday = now.getUTCDay() === 0;
      var h = now.getUTCHours();
      // Tasks may run Monday to Saturday at ANY hour. Only payouts are limited to
      // 09:00-17:00 Mon-Fri, so there is no task window to be outside of.
      var payoutOpen = !sunday && now.getUTCDay() !== 6 && h >= 9 && h < 17;
      var label, cls, detail;
      if (sunday) { cls = "dot dot--off"; label = "Sunday rest day"; detail = "Platform closed"; }
      else if (!d.enabled) { cls = "dot dot--off"; label = "Automation disabled"; detail = "Scheduler paused"; }
      else {
        cls = "dot dot--live";
        label = "Tasks open";
        if (d.next_task) { detail = "Next: " + d.next_task.label + " " + String(d.next_task.scheduled_time).slice(11, 16) + "Z"; }
        else if (d.retry_at) { detail = "Retry queued " + d.retry_at; }
        else { detail = payoutOpen ? "Payout window open until 17:00" : "Payouts: Mon-Fri 09:00-17:00"; }
      }
      dot.className = cls;
      state.textContent = label;
      sub.textContent = detail;
      if (win) win.textContent = "Tasks Mon-Sat, any hour - payouts 09:00-17:00 Mon-Fri";
      var chip = Ace.qs("#chip-status"), chipTxt = Ace.qs("#chip-status-text");
      if (chip) { chip.title = label + " — " + detail; if (chipTxt) chipTxt.textContent = label; }
      var heroDot = Ace.qs("#status-dot"), heroLabel = Ace.qs("#status-label"), heroDetail = Ace.qs("#status-detail");
      if (heroDot) {
        heroDot.className = "dot " + (cls.indexOf("live") > -1 ? "dot--live" : cls.indexOf("wait") > -1 ? "dot--wait" : "dot--off");
        heroLabel.textContent = label;
        heroDetail.textContent = detail;
      }
    }).catch(function () {});
  }

  function pollActive() {
    return Ace.api.json("/api/run/active").then(function (d) {
      var map = {};
      (d.running_ids || []).forEach(function (id) { map[Number(id)] = true; });
      Ace.state.runningIds = map;
      var chip = Ace.qs("#chip-batch");
      if (chip) chip.hidden = !d.is_batch_running;
      var btn = Ace.qs("#btn-run-all");
      if (btn) {
        btn.disabled = !!d.is_batch_running;
        btn.classList.toggle("is-busy", !!d.is_batch_running);
      }
      if (Ace.onRunningChange) Ace.onRunningChange();
    }).catch(function () {});
  }

  function updateNavCounts() {
    var c = Ace.qs("[data-nav-count]");
    if (c) c.textContent = Ace.state.accounts.length;
  }

  /* ---------------- Drawer / collapse ---------------- */
  function initLayoutEvents() {
    var app = Ace.qs("#app"), rail = Ace.qs("#rail-mount"), scrim = Ace.qs("#scrim");
    var collapsed = store(LS.collapsed) === "true";
    if (app) app.dataset.collapsed = collapsed ? "true" : "false";

    Ace.on(Ace.qs("#rail-collapse"), "click", function () {
      var next = app.dataset.collapsed !== "true";
      app.dataset.collapsed = next ? "true" : "false";
      store(LS.collapsed, next ? "true" : "false");
    });
    function drawer(open) {
      if (rail) rail.dataset.open = open ? "true" : "false";
      if (scrim) scrim.dataset.open = open ? "true" : "false";
    }
    Ace.on(Ace.qs("#btn-drawer"), "click", function () { drawer(rail.dataset.open !== "true"); });
    Ace.on(scrim, "click", function () { drawer(false); });
    Ace.qsa("[data-nav]").forEach(function (a) { a.addEventListener("click", function () { drawer(false); }); });

    window.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        var tag = (document.activeElement && document.activeElement.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        e.preventDefault();
        Ace.qs("#rail-collapse") && Ace.qs("#rail-collapse").click();
      }
    });
  }

  /* ---------------- Auth ---------------- */
  function guard() {
    if (Ace.state.preview) return Promise.resolve();
    return Ace.api.json("/api/auth/check").then(function (d) {
      if (d && d.authenticated === false) { location.href = route("/login"); }
    }).catch(function () { /* offline: allow viewing */ });
  }

  function logout() {
    Ace.api.json("/api/auth/logout", { method: "POST" }).catch(function () {})
      .then(function () { try { localStorage.removeItem("ace_token"); } catch (e) {} location.href = route("/login"); });
  }

  /* ---------------- Mount ---------------- */
  function mount() {
    var page = document.body.dataset.page || "overview";
    applyTheme();
    var rail = Ace.qs("#rail-mount");
    var topbar = Ace.qs("#topbar-mount");
    if (rail) rail.innerHTML = railMarkup(page);
    if (topbar) topbar.innerHTML = topbarMarkup(page);

    Ace.on(Ace.qs("#btn-theme"), "click", toggleTheme);
    Ace.on(Ace.qs("#btn-logout"), "click", logout);
    Ace.qsa("[data-theme-set]").forEach(function (b) { b.addEventListener("click", function () { setTheme(b.dataset.themeSet); }); });
    Ace.qsa("[data-contrast-toggle]").forEach(function (b) { b.addEventListener("click", toggleContrast); });
    Ace.qsa("[data-density-set]").forEach(function (b) { b.addEventListener("click", function () { setDensity(b.dataset.densitySet); }); });

    initLayoutEvents();
    reflectThemeButtons(store(LS.theme) || "dark", store(LS.contrast) === "true", store(LS.density) || "compact");

    var clock = Ace.qs("#chip-clock");
    function tick() { if (clock) clock.textContent = Ace.gmtClock(); }
    tick(); setInterval(tick, 1000);

    guard();
    loadScheduler();
    setInterval(loadScheduler, 30000);
    if (!Ace.state.preview) { pollActive(); setInterval(pollActive, 4000); }

    updateNavCounts();
    Ace.shell.setLinkState(true);
  }

  function setLinkState(ok) {
    var chip = Ace.qs("#chip-link");
    if (!chip) return;
    var t = chip.querySelector("[data-link-text]");
    if (Ace.state.preview) { if (t) t.textContent = "Preview"; chip.style.borderColor = "color-mix(in srgb, var(--warn) 40%, transparent)"; return; }
    if (t) t.textContent = ok ? "Live" : "Offline";
  }

  Ace.shell = {
    mount: mount,
    link: link,
    route: route,
    updateNavCounts: updateNavCounts,
    setLinkState: setLinkState,
    pollActive: pollActive,
    refreshScheduler: loadScheduler
  };
})();
