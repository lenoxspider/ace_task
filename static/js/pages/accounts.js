/* ============================================================================
   Page · Accounts — filterable fleet manager
   ========================================================================== */
(function () {
  "use strict";
  var Ace = window.Ace;
  var Pages = Ace.pages = Ace.pages || {};

  var filter = "all";
  var query = "";

  function counts() {
    var a = Ace.state.accounts;
    var active = a.filter(function (x) { return x.enabled === 1; }).length;
    var paused = a.filter(function (x) { return x.enabled === 0; }).length;
    var running = a.filter(function (x) { return Ace.isRunning(x.id) || x.last_status === "Running..."; }).length;
    return { all: a.length, active: active, paused: paused, running: running };
  }

  function renderFilterCounts() {
    var c = counts();
    set("[data-count=all]", c.all); set("[data-count=active]", c.active);
    set("[data-count=paused]", c.paused); set("[data-count=running]", c.running);
  }
  function set(sel, v) { Ace.qsa(sel).forEach(function (e) { e.textContent = v; }); }

  function visible() {
    var q = query.toLowerCase().trim();
    return Ace.state.accounts.filter(function (a) {
      if (q) {
        var hay = ((a.label || "") + " " + (a.phone || "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      if (filter === "active") return a.enabled === 1;
      if (filter === "paused") return a.enabled === 0;
      if (filter === "running") return Ace.isRunning(a.id) || a.last_status === "Running...";
      return true;
    });
  }

  function renderAccountList() {
    var host = Ace.qs("#accounts-list");
    if (!host) return;
    renderFilterCounts();
    var list = visible();
    var filtered = query || filter !== "all";
    Ace.accountRender(host, list,
      filtered ? "No accounts match this view" : "No accounts configured",
      filtered ? "Adjust the filter or search term." : "Add an account or import a CSV to get started.");
  }
  Pages.renderFilterCounts = renderFilterCounts;
  Pages.renderAccountList = renderAccountList;

  function loadAccounts() {
    return Ace.api.safe("/api/accounts", "accounts").then(function (list) {
      Ace.setAccounts(list || []);
      Ace.shell.updateNavCounts();
      renderAccountList();
    }).catch(function () {
      var host = Ace.qs("#accounts-list");
      if (host) host.innerHTML = '<div class="empty"><div class="empty__icon">' + Ace.icon("alert", 22) + '</div><b>Could not load accounts</b><p>The server did not respond.</p></div>';
    });
  }
  Pages.reloadAccounts = function () { loadAccounts(); if (Pages.reloadStats) Pages.reloadStats(); };

  function init() {
    Ace.qsa("[data-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        filter = b.dataset.filter;
        Ace.qsa("[data-filter]").forEach(function (x) { x.setAttribute("aria-selected", "false"); });
        b.setAttribute("aria-selected", "true");
        renderAccountList();
      });
    });
    Ace.on(Ace.qs("#account-search"), "input", function (e) { query = e.target.value; renderAccountList(); });
    Ace.on(Ace.qs("#btn-add"), "click", function () { Ace.modals.openAccount(); });
    Ace.on(Ace.qs("#btn-import"), "click", function () { Ace.modals.openImport(); });
    Ace.on(Ace.qs("#btn-run-all"), "click", function () {
      Ace.api.post("/api/run-all")
        .then(function () { Ace.toast("Batch started", "All active accounts queued.", "ok"); Ace.shell.pollActive(); })
        .catch(function (e) { Ace.toast("Cannot start", e.message, "err"); });
    });
  }

  Ace.onRunningChange = function () { if (Ace.qs("#accounts-list")) renderAccountList(); };

  document.addEventListener("DOMContentLoaded", function () {
    Ace.shell.mount();
    Ace.modals.init();
    Ace.bindAccountActions(document);
    init();
    loadAccounts();
  });
})();
