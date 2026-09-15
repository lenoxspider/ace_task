/* ============================================================================
   Page · Withdrawals — queue, auto-withdraw rules, payout config
   ========================================================================== */
(function () {
  "use strict";
  var Ace = window.Ace;
  var esc = Ace.esc;
  var DENOMS = [65, 170, 525, 1600, 4500, 14000, 33500, 65000, 150000, 200000, 500000, 1000000];

  function statusTone(s) {
    s = String(s || "").toLowerCase();
    if (s === "processing" || s === "submitted") return "info";
    if (s === "queued") return "warn";
    if (s === "completed" || s === "success") return "ok";
    if (s === "failed" || s === "cancelled") return "err";
    return "dim";
  }

  /* ---------------- Queue ---------------- */
  function loadQueue() {
    var body = Ace.qs("#queue-rows");
    return Ace.api.safe("/api/withdrawals/queue", "queue").then(function (d) {
      var rows = (d && d.queue) || [];
      var badge = Ace.qs("#queue-count");
      if (badge) badge.textContent = rows.length + " pending";
      var meta = Ace.qs("#queue-meta");
      if (meta && d) meta.textContent = "Pacing " + (d.min_spacing || 25) + "–" + (d.max_spacing || 50) + " min · window " + (d.window || "09:00–17:00 Mon–Fri");
      if (!rows.length) { body.innerHTML = '<tr><td colspan="7" class="table__empty">No withdrawals in the queue.</td></tr>'; return; }
      body.innerHTML = rows.map(function (q) {
        var tone = statusTone(q.status);
        var cancellable = q.status === "queued";
        return '<tr>' +
          '<td class="mono">#' + esc(q.id) + '</td>' +
          '<td class="t-main">' + esc(q.label || q.phone) + '</td>' +
          '<td class="t-right mono">' + Ace.money(q.amount) + ' <span class="dim">GHS</span></td>' +
          '<td><span class="badge ' + Ace.toneBadge(tone) + ' badge--dot">' + esc(q.status || "—") + '</span></td>' +
          '<td class="mono">' + esc(q.scheduled_for || "—") + '</td>' +
          '<td class="dim">' + esc(q.result_message || "—") + '</td>' +
          '<td class="t-right">' + (cancellable
            ? '<button class="btn btn--sm btn--danger" data-cancel="' + esc(q.id) + '">Cancel</button>'
            : '<span class="dim">—</span>') + '</td>' +
        '</tr>';
      }).join("");
      Ace.qsa("#queue-rows [data-cancel]").forEach(function (b) {
        b.addEventListener("click", function () {
          Ace.busy(b, true);
          Ace.api.post("/api/withdrawals/queue/" + b.dataset.cancel + "/cancel")
            .then(function () { Ace.toast("Cancelled", "Queued withdrawal removed.", "warn"); loadQueue(); })
            .catch(function (e) { Ace.toast("Cancel failed", e.message, "err"); Ace.busy(b, false); });
        });
      });
    }).catch(function () { if (body) body.innerHTML = '<tr><td colspan="7" class="table__empty">Could not load the queue.</td></tr>'; });
  }

  /* ---------------- Auto-withdraw configurator ---------------- */
  function accountOptions() {
    return '<option value="">Choose an account…</option>' + Ace.state.accounts.map(function (a) {
      return '<option value="' + a.id + '">' + esc((a.label || a.phone) + " · +" + a.phone) + '</option>';
    }).join("");
  }
  function fillDenom(list) {
    var values = (list && list.length ? list : DENOMS);
    var sel = Ace.qs("#cfg-amount"); var grid = Ace.qs("#cfg-pills");
    if (sel) sel.innerHTML = '<option value="0">Full balance / auto-max</option>' +
      values.map(function (v) { return '<option value="' + v + '">' + Ace.num(v) + ' GHS</option>'; }).join("");
    if (grid) grid.innerHTML = '<button type="button" data-amt="0" aria-pressed="false">Full</button>' +
      values.map(function (v) { return '<button type="button" data-amt="' + v + '" aria-pressed="false">' + v + '</button>'; }).join("");
  }
  function syncPills(v) {
    Ace.qsa("#cfg-pills [data-amt]").forEach(function (b) { b.setAttribute("aria-pressed", Number(b.dataset.amt) === Number(v) ? "true" : "false"); });
  }

  function selectAccount(id) {
    var a = Ace.accountById(id);
    if (!a) { Ace.qs("#cfg-hint").textContent = "Select an account to load its auto-withdrawal rule."; return; }
    Ace.qs("#cfg-auto").checked = a.auto_withdraw === 1;
    Ace.qs("#cfg-wallet").value = String(a.withdraw_wallet || 2);
    fillDenom(DENOMS);
    Ace.qs("#cfg-amount").value = String(a.withdraw_amount || 0);
    syncPills(a.withdraw_amount || 0);
    Ace.qs("#cfg-pin").value = "";
    Ace.qs("#cfg-hint").textContent = (a.label || a.phone) + " · VIP " + (a.vip_level || "?") + " · balance " + (a.balance || "0") + " GHS";
  }

  function saveConfig() {
    var id = Ace.qs("#cfg-account").value;
    if (!id) { banner("err", "Select an account first."); return; }
    var btn = Ace.qs("#cfg-save");
    Ace.busy(btn, true);
    var payload = {
      auto_withdraw: Ace.qs("#cfg-auto").checked ? 1 : 0,
      withdraw_amount: Number(Ace.qs("#cfg-amount").value || 0),
      withdraw_wallet: Number(Ace.qs("#cfg-wallet").value || 2)
    };
    var pin = Ace.qs("#cfg-pin").value;
    if (pin) payload.pay_password = pin;
    Ace.api.put("/api/accounts/" + id, payload)
      .then(function () { banner("ok", "Auto-withdrawal rule saved."); Ace.toast("Rule saved", "Payout rule updated.", "ok"); loadAccounts(); })
      .catch(function (e) { banner("err", e.message || "Save failed."); })
      .then(function () { Ace.busy(btn, false); });
  }

  function syncTiers() {
    var id = Ace.qs("#cfg-account").value;
    if (!id) { banner("err", "Select an account first."); return; }
    var btn = Ace.qs("#cfg-sync");
    Ace.busy(btn, true);
    banner("info", "Fetching withdrawal tiers from Ace775…");
    Ace.api.safe("/api/accounts/" + id + "/withdrawal-options?refresh=true", "withdrawalOptions")
      .then(function (d) {
        if (d && d.withdrawal_amounts) { fillDenom(d.withdrawal_amounts); banner("ok", "Synced " + d.withdrawal_amounts.length + " tiers. Min " + d.min_amount + " GHS."); }
        else banner("warn", "No tiers returned.");
      })
      .catch(function (e) { banner("err", e.message || "Sync failed."); })
      .then(function () { Ace.busy(btn, false); });
  }

  function banner(tone, msg) {
    var el = Ace.qs("#cfg-banner");
    if (!el) return;
    if (!tone) { el.dataset.show = "false"; return; }
    var ic = tone === "ok" ? "checkcircle" : tone === "err" ? "xcircle" : tone === "warn" ? "alert" : "info";
    el.className = "banner banner--" + tone; el.dataset.show = "true";
    el.innerHTML = Ace.icon(ic, 16) + '<span>' + esc(msg) + '</span>';
  }

  /* ---------------- Payout config table ---------------- */
  function renderPayouts() {
    var body = Ace.qs("#payout-rows");
    if (!body) return;
    var list = Ace.state.accounts;
    if (!list.length) { body.innerHTML = '<tr><td colspan="7" class="table__empty">No accounts configured.</td></tr>'; return; }
    body.innerHTML = list.map(function (a) {
      return '<tr>' +
        '<td class="t-main">' + esc(a.label || a.phone) + '<div class="dim mono" style="font-size:var(--fs-micro)">+' + esc(a.phone) + '</div></td>' +
        '<td class="t-right mono">' + esc(a.balance || "0") + ' <span class="dim">GHS</span></td>' +
        '<td>' + (a.auto_withdraw === 1 ? '<span class="badge badge--accent">on</span>' : '<span class="badge">off</span>') + '</td>' +
        '<td class="t-right mono">' + (Number(a.withdraw_amount) > 0 ? Ace.num(a.withdraw_amount) + ' GHS' : "Full balance") + '</td>' +
        '<td class="mono">' + esc(a.last_withdraw_date || "—") + '</td>' +
        '<td>' + (a.last_withdraw_status ? '<span class="badge badge--dot ' + Ace.toneBadge(Ace.statusTone(a.last_withdraw_status)) + '">' + esc(a.last_withdraw_status) + '</span>' : '<span class="dim">—</span>') + '</td>' +
        '<td class="t-right"><button class="btn btn--sm" data-row-action="withdraw" data-id="' + a.id + '">' + Ace.icon("cash", 13) + 'Withdraw</button></td>' +
      '</tr>';
    }).join("");
    Ace.qsa("#payout-rows [data-row-action]").forEach(function (b) {
      b.addEventListener("click", function () { Ace.modals.openWithdraw(Number(b.dataset.id)); });
    });
  }

  function loadAccounts() {
    return Ace.api.safe("/api/accounts", "accounts").then(function (list) {
      Ace.setAccounts(list || []);
      Ace.shell.updateNavCounts();
      var sel = Ace.qs("#cfg-account");
      var prev = sel ? sel.value : "";
      if (sel) { sel.innerHTML = accountOptions(); if (prev) sel.value = prev; }
      renderPayouts();
      loadQueue();
    }).catch(function () { loadQueue(); });
  }

  function init() {
    Ace.qsa("#cfg-pills") && Ace.qs("#cfg-pills").addEventListener("click", function (e) {
      var b = e.target.closest("[data-amt]"); if (!b) return;
      Ace.qs("#cfg-amount").value = b.dataset.amt; syncPills(b.dataset.amt);
    });
    Ace.on(Ace.qs("#cfg-amount"), "change", function (e) { syncPills(e.target.value); });
    Ace.on(Ace.qs("#cfg-account"), "change", function (e) { banner(null); selectAccount(e.target.value); });
    Ace.on(Ace.qs("#cfg-save"), "click", saveConfig);
    Ace.on(Ace.qs("#cfg-sync"), "click", syncTiers);
    Ace.on(Ace.qs("#btn-queue-refresh"), "click", loadQueue);
    Ace.on(Ace.qs("#btn-withdraw"), "click", function () { Ace.modals.openWithdraw(); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    Ace.shell.mount();
    Ace.modals.init();
    init();
    fillDenom(DENOMS); syncPills(0);
    loadAccounts();
  });
})();
