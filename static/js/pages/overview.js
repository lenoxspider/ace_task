/* ============================================================================
   Page · Overview — KPIs, 7-day trend, active rotation, live console preview
   ========================================================================== */
(function () {
  "use strict";
  var Ace = window.Ace;
  var esc = Ace.esc;
  var Pages = Ace.pages = Ace.pages || {};

  var stream = null;

  function renderStats(s) {
    if (!s) return;
    set("#kpi-total", Ace.num(s.total_accounts));
    set("#kpi-total-sub", s.total_accounts + " configured");
    set("#kpi-active", Ace.num(s.active_accounts));
    set("#kpi-active-sub", s.total_accounts ? Math.round(s.active_accounts / s.total_accounts * 100) + "% of fleet in rotation" : "—");
    set("#kpi-tasks", Ace.num(s.tasks_completed_today));
    set("#kpi-tasks-sub", "Lifetime " + Ace.num(s.lifetime_tasks) + " tasks");
    Ace.qs("#kpi-earned").innerHTML = Ace.money(s.total_earned_today) + " <small>GHS</small>";
    set("#kpi-earned-sub", "Lifetime " + Ace.money(s.lifetime_earned) + " GHS");
  }
  function set(sel, txt) { var e = Ace.qs(sel); if (e) e.textContent = txt; }

  function renderChart(days) {
    var host = Ace.qs("#chart");
    if (!host) return;
    if (!days || !days.length) { host.innerHTML = '<div class="empty" style="grid-column:1/-1"><b>No analytics yet</b><p>Daily earnings appear here once tasks run.</p></div>'; return; }
    var max = Math.max.apply(null, days.map(function (d) { return Number(d.earned) || 0; }).concat([10]));
    var today = Ace.todayStr();
    host.innerHTML = days.map(function (d) {
      var pct = Math.max(Math.round((Number(d.earned) / max) * 100), 3);
      var isToday = d.date === today;
      return '<div class="chart__col' + (isToday ? " is-today" : "") + '" title="' + esc(d.date) + ' · ' + esc(d.earned) + ' GHS · ' + esc(d.tasks) + ' tasks">' +
        '<span class="chart__val">' + (Number(d.earned) > 0 ? "+" + Ace.money(d.earned) : "0") + '</span>' +
        '<div class="chart__bar" style="height:' + pct + '%"></div>' +
        '<span class="chart__label">' + esc(d.label) + '</span></div>';
    }).join("");
  }

  function renderActive(list) {
    var host = Ace.qs("#overview-accounts");
    if (!host) return;
    var active = list.filter(function (a) { return a.enabled === 1; });
    if (!active.length) {
      host.innerHTML = '<div class="empty"><div class="empty__icon">' + Ace.icon("users", 22) + '</div>' +
        '<b>No accounts in rotation</b><p>Add an account or resume a paused one to start automated tasks.</p></div>';
      return;
    }
    host.innerHTML = active.map(Ace.accountRow).join("");
    var badge = Ace.qs("#rot-count");
    if (badge) badge.textContent = active.length + " active";
  }

  function loadStats() { return Ace.api.safe("/api/stats", "stats").then(renderStats).catch(function () {}); }
  function loadAnalytics() { return Ace.api.safe("/api/analytics/7days", "analytics").then(renderChart).catch(function () {}); }
  function loadAccounts() {
    return Ace.api.safe("/api/accounts", "accounts").then(function (list) {
      Ace.setAccounts(list || []);
      Ace.shell.updateNavCounts();
      renderActive(Ace.state.accounts);
      if (typeof Pages.renderFilterCounts === "function") Pages.renderFilterCounts();
    }).catch(function () {});
  }
  function reload() { loadStats(); loadAnalytics(); loadAccounts(); }
  Pages.reloadStats = loadStats;
  Pages.reloadAnalytics = loadAnalytics;
  Pages.reloadAccounts = loadAccounts;
  Pages.overviewReload = reload;

  function initTerminal() {
    var host = Ace.qs("#term-preview");
    if (!host) return;
    stream = Ace.stream.attach({ container: host, onAccountState: function () { if (Pages.renderAccountList) Pages.renderAccountList(); } });

    Ace.qsa("#term-toolbar [data-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        Ace.qsa("#term-toolbar [data-filter]").forEach(function (x) { x.setAttribute("aria-selected", "false"); });
        b.setAttribute("aria-selected", "true");
        if (stream) stream.setFilter(b.dataset.filter);
      });
    });
    Ace.on(Ace.qs("#term-search"), "input", function (e) { if (stream) stream.setSearch(e.target.value); });
    Ace.on(Ace.qs("#term-pause"), "click", function (e) {
      var on = stream.togglePause();
      e.currentTarget.setAttribute("aria-pressed", on ? "true" : "false");
      e.currentTarget.innerHTML = Ace.icon(on ? "play" : "pause", 14) + (on ? "Resume" : "Pause");
    });
    Ace.on(Ace.qs("#term-clear"), "click", function () { if (stream) stream.clear(); });
  }

  function initActions() {
    Ace.on(Ace.qs("#btn-run-all"), "click", function () {
      Ace.api.post("/api/run-all")
        .then(function () { Ace.toast("Batch started", "All active accounts queued.", "ok"); Ace.shell.pollActive(); })
        .catch(function (e) { Ace.toast("Cannot start", e.message, "err"); });
    });
    Ace.on(Ace.qs("#btn-add"), "click", function () { Ace.modals.openAccount(); });
    Ace.on(Ace.qs("#btn-import"), "click", function () { Ace.modals.openImport(); });
    Ace.on(Ace.qs("#btn-export"), "click", function () {
      if (Ace.state.preview) { Ace.toast("Export unavailable", "Connect the app server to export reports.", "warn"); return; }
      location.href = "/api/export/csv";
    });
  }

  Ace.onRunningChange = function () { renderActive(Ace.state.accounts); };

  document.addEventListener("DOMContentLoaded", function () {
    Ace.shell.mount();
    Ace.modals.init();
    Ace.bindAccountActions(document);
    initActions();
    reload();
    initTerminal();
  });
})();
