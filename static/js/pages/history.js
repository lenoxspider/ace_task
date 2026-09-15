/* ============================================================================
   Page · Audit History — execution records + CSV export
   ========================================================================== */
(function () {
  "use strict";
  var Ace = window.Ace;
  var esc = Ace.esc;

  function renderRows(rows) {
    var body = Ace.qs("#history-rows");
    var count = Ace.qs("#history-count");
    if (count) count.textContent = (rows || []).length + " records";
    if (!rows || !rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="table__empty">No execution records yet.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (h) {
      var tone = Ace.statusTone(h.status);
      return '<tr>' +
        '<td class="mono">' + esc(Ace.stamp(h.run_time)) + '</td>' +
        '<td class="t-main">' + esc(h.label || h.phone) + '<div class="dim mono" style="font-size:var(--fs-micro)">+' + esc(h.phone) + '</div></td>' +
        '<td><span class="badge ' + Ace.toneBadge(tone) + ' badge--dot">' + esc(h.status || "—") + '</span></td>' +
        '<td class="t-right mono">' + Ace.num(h.tasks_done) + '</td>' +
        '<td class="t-right mono ' + (Number(h.earned) > 0 ? "text-ok" : "") + '">' + Ace.money(h.earned, true) + ' <span class="dim">GHS</span></td>' +
        '<td class="t-right mono">' + esc(h.balance || "0") + ' <span class="dim">GHS</span></td>' +
      '</tr>';
    }).join("");
  }

  function load() {
    var body = Ace.qs("#history-rows");
    if (body) body.innerHTML = '<tr><td colspan="6" class="table__empty">Loading…</td></tr>';
    var acc = Ace.qs("#history-account");
    var q = acc && acc.value ? "?account_id=" + acc.value + "&limit=150" : "?limit=150";
    return Ace.api.safe("/api/history" + q, "history")
      .then(renderRows)
      .catch(function () { if (body) body.innerHTML = '<tr><td colspan="6" class="table__empty">Could not load history.</td></tr>'; });
  }

  function loadAccounts() {
    return Ace.api.safe("/api/accounts", "accounts").then(function (list) {
      Ace.setAccounts(list || []);
      Ace.shell.updateNavCounts();
      var sel = Ace.qs("#history-account");
      if (sel) {
        sel.innerHTML = '<option value="">All accounts</option>' + Ace.state.accounts.map(function (a) {
          return '<option value="' + a.id + '">' + esc(a.label || a.phone) + '</option>';
        }).join("");
      }
      load();
    }).catch(load);
  }

  document.addEventListener("DOMContentLoaded", function () {
    Ace.shell.mount();
    Ace.modals.init();
    Ace.on(Ace.qs("#history-account"), "change", load);
    Ace.on(Ace.qs("#btn-refresh"), "click", load);
    Ace.on(Ace.qs("#btn-export"), "click", function () {
      if (Ace.state.preview) { Ace.toast("Export unavailable", "Connect the app server to export reports.", "warn"); return; }
      location.href = "/api/export/csv";
    });
    Ace.on(Ace.qs("#btn-open-history"), "click", function () { Ace.modals.openHistory(); });
    loadAccounts();
  });
})();
