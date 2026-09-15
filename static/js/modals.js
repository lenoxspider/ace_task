/* ============================================================================
   Modals — account editor, CSV import, withdrawal, history
   Injects markup into #modal-root + wires all handlers.
   Public: Ace.modals.openAccount(id?) openImport() openWithdraw(id) openHistory(id?)
   ========================================================================== */
(function () {
  "use strict";
  var Ace = window.Ace;
  var esc = Ace.esc;

  var DENOMS = [65, 170, 525, 1600, 4500, 14000, 33500, 65000, 150000, 200000, 500000, 1000000];
  var WALLETS = [{ v: 2, t: "Income / commission" }, { v: 1, t: "Personal wallet" }];

  function fmtDenom(v) { return v === 0 ? "Full balance" : Ace.num(v) + " GHS"; }
  function denomOptions() {
    return '<option value="0">Full balance / auto-max</option>' +
      DENOMS.map(function (d) { return '<option value="' + d + '">' + Ace.num(d) + ' GHS</option>'; }).join("");
  }
  function walletOptions() {
    return WALLETS.map(function (w) { return '<option value="' + w.v + '">' + w.t + '</option>'; }).join("");
  }
  function pills() {
    return '<button type="button" data-amt="0" aria-pressed="false">Full</button>' +
      DENOMS.map(function (d) { return '<button type="button" data-amt="' + d + '" aria-pressed="false">' + d + '</button>'; }).join("");
  }

  function markup() {
    return '' +
    /* ---- Account editor ---- */
    '<div class="modal" id="modal-account" role="dialog" aria-modal="true" aria-labelledby="acc-title">' +
      '<div class="modal__scrim"></div>' +
      '<div class="modal__card modal__card--wide">' +
        '<div class="modal__head"><h3 id="acc-title">Add account</h3>' +
          '<button class="iconbtn" data-close aria-label="Close">' + Ace.icon("close", 15) + '</button></div>' +
        '<div class="modal__body">' +
          '<form id="form-account" class="stack" style="gap:var(--s4)" novalidate>' +
            '<input type="hidden" id="acc-id">' +
            '<div class="formcard">' +
              '<div class="formcard__head"><span class="eyebrow">Credentials</span></div>' +
              '<div class="formgrid">' +
                '<div class="field"><label for="acc-phone">Ghana phone number</label>' +
                  '<input id="acc-phone" type="text" inputmode="tel" placeholder="0501234567" required autocomplete="username"></div>' +
                '<div class="field"><label for="acc-password">Account password</label>' +
                  '<input id="acc-password" type="password" placeholder="Ace775 password" autocomplete="off"></div>' +
                '<div class="field span-2"><label for="acc-label">Label</label>' +
                  '<input id="acc-label" type="text" placeholder="e.g. Main account, VIP4 runner">' +
                  '<span class="field__hint">A leading zero or +233 is normalised automatically.</span></div>' +
              '</div>' +
            '</div>' +
            '<div class="formcard">' +
              '<div class="formcard__head"><span class="eyebrow">Execution &amp; limits</span></div>' +
              '<div class="formgrid">' +
                '<div class="field"><label for="acc-mode">Execution mode</label>' +
                  '<select id="acc-mode"><option value="api">API (fast)</option><option value="browser">Browser (Playwright)</option></select></div>' +
                '<div class="field"><label for="acc-maxtasks">Task cap</label>' +
                  '<input id="acc-maxtasks" type="number" min="0" value="0" placeholder="0 = all tasks"></div>' +
                '<div class="field"><label for="acc-wstart">Task window start (GMT)</label>' +
                  '<input id="acc-wstart" type="time"></div>' +
                '<div class="field"><label for="acc-wend">Task window end (GMT)</label>' +
                  '<input id="acc-wend" type="time"><span class="field__hint">Blank uses the default window.</span></div>' +
              '</div>' +
              '<label class="switch"><input type="checkbox" id="acc-enabled" checked>' +
                '<span class="switch__track"></span>' +
                '<span class="switch__text"><b>Enable account</b><small>Active in the automated daily rotation</small></span></label>' +
            '</div>' +
            '<div class="formcard">' +
              '<div class="formcard__head"><span class="eyebrow">Auto-withdrawal</span>' +
                '<label class="switch"><input type="checkbox" id="acc-auto">' +
                  '<span class="switch__track"></span><span class="switch__text"><small>Enabled</small></span></label></div>' +
              '<div id="acc-auto-fields" hidden class="stack" style="gap:var(--s4)">' +
                '<div class="formgrid">' +
                  '<div class="field"><label for="acc-wamount">Fixed payout amount</label>' +
                    '<select id="acc-wamount">' + denomOptions() + '</select></div>' +
                  '<div class="field"><label for="acc-wwallet">Payout wallet</label>' +
                    '<select id="acc-wwallet">' + walletOptions() + '</select></div>' +
                '</div>' +
                '<div class="amounts" id="acc-pills">' + pills() + '</div>' +
                '<div class="field"><label for="acc-paypw">Transaction PIN / pay password</label>' +
                  '<input id="acc-paypw" type="password" placeholder="6-digit PIN" autocomplete="off">' +
                  '<span class="field__hint">Stored encrypted. Required by Ace775 to pay out to your MoMo.</span></div>' +
              '</div>' +
            '</div>' +
          '</form>' +
          '<div class="banner" id="acc-banner"></div>' +
        '</div>' +
        '<div class="modal__foot">' +
          '<button class="btn btn--ghost" data-close>Cancel</button>' +
          '<button class="btn" id="acc-test">' + Ace.icon("search", 15) + 'Test login</button>' +
          '<button class="btn btn--primary" id="acc-save">' + Ace.icon("check", 15) + 'Verify &amp; save</button>' +
        '</div>' +
      '</div>' +
    '</div>' +

    /* ---- CSV import ---- */
    '<div class="modal" id="modal-import" role="dialog" aria-modal="true" aria-labelledby="imp-title">' +
      '<div class="modal__scrim"></div>' +
      '<div class="modal__card">' +
        '<div class="modal__head"><h3 id="imp-title">Batch import (CSV)</h3>' +
          '<button class="iconbtn" data-close aria-label="Close">' + Ace.icon("close", 15) + '</button></div>' +
        '<div class="modal__body"><form id="form-import" novalidate>' +
          '<p class="field__hint">Paste comma-separated rows, or choose a <code>.csv</code> file. Format: ' +
            '<code>phone,password,label,mode,max_tasks</code> — label, mode and max_tasks are optional.</p>' +
          '<div class="field"><label for="imp-file">CSV file</label><input id="imp-file" type="file" accept=".csv,.txt"></div>' +
          '<div class="field"><label for="imp-text">CSV content</label>' +
            '<textarea id="imp-text" rows="7" placeholder="509295199,secretpass,Account 1,api,0&#10;501234567,otherpass,User 2,api,0"></textarea></div>' +
          '<div class="banner" id="imp-banner"></div>' +
        '</form></div>' +
        '<div class="modal__foot"><button class="btn btn--ghost" data-close>Cancel</button>' +
          '<button class="btn btn--primary" id="imp-submit">' + Ace.icon("bolt", 15) + 'Verify &amp; import</button></div>' +
      '</div>' +
    '</div>' +

    /* ---- Manual withdrawal ---- */
    '<div class="modal" id="modal-withdraw" role="dialog" aria-modal="true" aria-labelledby="wd-title">' +
      '<div class="modal__scrim"></div>' +
      '<div class="modal__card">' +
        '<div class="modal__head"><h3 id="wd-title">Request withdrawal</h3>' +
          '<button class="iconbtn" data-close aria-label="Close">' + Ace.icon("close", 15) + '</button></div>' +
        '<div class="modal__body"><form id="form-withdraw" novalidate>' +
          '<div class="panel" style="background:var(--ink-850)"><div class="panel__body stack" style="gap:8px">' +
            '<div class="row row--between"><span class="dim">Account</span><b id="wd-acc" class="mono">—</b></div>' +
            '<div class="row row--between"><span class="dim">Available balance</span><b id="wd-bal" class="mono text-ok">0.00 GHS</b></div>' +
            '<div class="row row--between"><span class="dim">Platform window</span><b class="mono text-info">09:00–17:00 · once daily</b></div>' +
          '</div></div>' +
          '<input type="hidden" id="wd-acc-id">' +
          '<div class="field"><label for="wd-amount">Fixed amount</label>' +
            '<select id="wd-amount">' + DENOMS.map(function (d) { return '<option value="' + d + '"' + (d === 65 ? " selected" : "") + '>' + Ace.num(d) + ' GHS</option>'; }).join("") + '</select></div>' +
          '<div class="amounts" id="wd-pills">' + DENOMS.map(function (d) { return '<button type="button" data-amt="' + d + '" aria-pressed="' + (d === 65 ? "true" : "false") + '">' + d + '</button>'; }).join("") + '</div>' +
          '<div class="field"><label for="wd-wallet">Payout wallet</label><select id="wd-wallet">' + walletOptions() + '</select></div>' +
          '<div class="field"><label for="wd-pin">Transaction PIN / pay password</label>' +
            '<input id="wd-pin" type="password" placeholder="Payment password" required autocomplete="off"></div>' +
          '<div class="banner" id="wd-banner"></div>' +
        '</form></div>' +
        '<div class="modal__foot"><button class="btn btn--ghost" data-close>Cancel</button>' +
          '<button class="btn btn--primary" id="wd-submit">' + Ace.icon("cash", 15) + 'Submit withdrawal</button></div>' +
      '</div>' +
    '</div>' +

    /* ---- History ---- */
    '<div class="modal" id="modal-history" role="dialog" aria-modal="true" aria-labelledby="hist-title">' +
      '<div class="modal__scrim"></div>' +
      '<div class="modal__card modal__card--wide">' +
        '<div class="modal__head"><h3 id="hist-title">Execution history</h3>' +
          '<span class="badge" id="hist-count">0</span>' +
          '<button class="iconbtn" data-close aria-label="Close" style="margin-left:auto">' + Ace.icon("close", 15) + '</button></div>' +
        '<div class="modal__body" style="padding:0">' +
          '<div class="tablewrap" style="max-height:60dvh"><table class="table">' +
            '<thead><tr><th>Time</th><th>Account</th><th>Status</th><th class="t-right">Tasks</th><th class="t-right">Earned</th><th class="t-right">Balance</th></tr></thead>' +
            '<tbody id="hist-rows"><tr><td colspan="6" class="table__empty">Loading…</td></tr></tbody>' +
          '</table></div>' +
        '</div>' +
        '<div class="modal__foot"><button class="btn btn--ghost" data-close>Close</button></div>' +
      '</div>' +
    '</div>';
  }

  /* ---------------- helpers ---------------- */
  function banner(id, tone, msg) {
    var el = Ace.qs("#" + id);
    if (!el) return;
    if (!tone) { el.dataset.show = "false"; el.innerHTML = ""; return; }
    var ic = tone === "ok" ? "checkcircle" : tone === "err" ? "xcircle" : tone === "warn" ? "alert" : "info";
    el.className = "banner banner--" + tone;
    el.dataset.show = "true";
    el.innerHTML = Ace.icon(ic, 16) + '<span>' + esc(msg) + '</span>';
  }
  function wirePills(gridId, selectId, onPick) {
    var grid = Ace.qs("#" + gridId);
    var sel = Ace.qs("#" + selectId);
    if (grid) grid.addEventListener("click", function (e) {
      var b = e.target.closest("[data-amt]"); if (!b) return;
      var v = Number(b.dataset.amt);
      if (sel) sel.value = String(v);
      syncPills(gridId, v);
      if (onPick) onPick(v);
    });
    if (sel) sel.addEventListener("change", function () { syncPills(gridId, Number(sel.value)); if (onPick) onPick(Number(sel.value)); });
  }
  function syncPills(gridId, value) {
    Ace.qsa("#" + gridId + " [data-amt]").forEach(function (b) {
      b.setAttribute("aria-pressed", Number(b.dataset.amt) === Number(value) ? "true" : "false");
    });
  }

  /* ---------------- Account editor ---------------- */
  function fillDenoms(list) {
    var sel = Ace.qs("#acc-wamount");
    var grid = Ace.qs("#acc-pills");
    var values = (list && list.length ? list : DENOMS);
    if (sel) sel.innerHTML = '<option value="0">Full balance / auto-max</option>' +
      values.map(function (d) { return '<option value="' + d + '">' + Ace.num(d) + ' GHS</option>'; }).join("");
    if (grid) grid.innerHTML = '<button type="button" data-amt="0" aria-pressed="false">Full</button>' +
      values.map(function (d) { return '<button type="button" data-amt="' + d + '" aria-pressed="false">' + d + '</button>'; }).join("");
  }

  function openAccount(id) {
    var acc = id ? Ace.accountById(id) : null;
    var isEdit = !!acc;
    Ace.qs("#acc-title").textContent = isEdit ? "Edit account" : "Add account";
    Ace.qs("#acc-id").value = isEdit ? acc.id : "";
    Ace.qs("#acc-phone").value = isEdit ? acc.phone : "";
    Ace.qs("#acc-password").value = "";
    Ace.qs("#acc-password").placeholder = isEdit ? "Leave blank to keep current" : "Ace775 password";
    Ace.qs("#acc-label").value = isEdit ? (acc.label || "") : "";
    Ace.qs("#acc-mode").value = isEdit ? (acc.mode || "api") : "api";
    Ace.qs("#acc-maxtasks").value = isEdit ? (acc.max_tasks || 0) : 0;
    Ace.qs("#acc-enabled").checked = isEdit ? acc.enabled !== 0 : true;
    Ace.qs("#acc-wstart").value = isEdit ? (acc.window_start || "") : "";
    Ace.qs("#acc-wend").value = isEdit ? (acc.window_end || "") : "";
    Ace.qs("#acc-auto").checked = isEdit ? acc.auto_withdraw === 1 : false;
    Ace.qs("#acc-paypw").value = "";
    fillDenoms(DENOMS);
    Ace.qs("#acc-wamount").value = isEdit ? String(acc.withdraw_amount || 0) : "0";
    Ace.qs("#acc-wwallet").value = isEdit ? String(acc.withdraw_wallet || 2) : "2";
    syncPills("acc-pills", isEdit ? (acc.withdraw_amount || 0) : 0);
    toggleAutoFields();
    banner("acc-banner", null);
    Ace.Modal.open("modal-account");
  }

  function toggleAutoFields() {
    var on = Ace.qs("#acc-auto").checked;
    var box = Ace.qs("#acc-auto-fields");
    if (box) box.hidden = !on;
  }

  function payload() {
    var p = {
      phone: Ace.qs("#acc-phone").value.trim(),
      label: Ace.qs("#acc-label").value.trim(),
      mode: Ace.qs("#acc-mode").value,
      max_tasks: Number(Ace.qs("#acc-maxtasks").value || 0),
      enabled: Ace.qs("#acc-enabled").checked ? 1 : 0,
      window_start: Ace.qs("#acc-wstart").value || "",
      window_end: Ace.qs("#acc-wend").value || "",
      auto_withdraw: Ace.qs("#acc-auto").checked ? 1 : 0,
      withdraw_amount: Number(Ace.qs("#acc-wamount").value || 0),
      withdraw_wallet: Number(Ace.qs("#acc-wwallet").value || 2)
    };
    var pw = Ace.qs("#acc-password").value;
    if (pw) p.password = pw;
    var pin = Ace.qs("#acc-paypw").value;
    if (pin) p.pay_password = pin;
    return p;
  }

  function saveAccount() {
    var id = Ace.qs("#acc-id").value;
    var p = payload();
    if (!p.phone) { banner("acc-banner", "err", "Phone number is required."); return; }
    var btn = Ace.qs("#acc-save");
    Ace.busy(btn, true);
    var req = id ? Ace.api.put("/api/accounts/" + id, p) : Ace.api.post("/api/accounts", p);
    req.then(function () {
      Ace.toast("Saved", (id ? "Account updated." : "Account added."), "ok");
      Ace.Modal.close("modal-account");
      if (Ace.pages && Ace.pages.reloadAccounts) Ace.pages.reloadAccounts();
    }).catch(function (e) { banner("acc-banner", "err", e.message || "Save failed."); })
      .then(function () { Ace.busy(btn, false); });
  }

  function testLogin() {
    var id = Ace.qs("#acc-id").value;
    var phone = Ace.qs("#acc-phone").value.trim();
    var pw = Ace.qs("#acc-password").value;
    if (!phone) { banner("acc-banner", "err", "Enter a phone number first."); return; }
    var btn = Ace.qs("#acc-test");
    Ace.busy(btn, true);
    banner("acc-banner", "info", "Verifying credentials with Ace775…");
    Ace.api.post("/api/accounts/verify", { account_id: id ? Number(id) : null, phone: phone, password: pw })
      .then(function (d) {
        banner("acc-banner", "ok", "Login OK — VIP " + esc(d.grade || d.vip_level || "?") + ", balance " + esc(d.balance || "0") + " GHS.");
      })
      .catch(function (e) { banner("acc-banner", "err", e.message || "Verification failed."); })
      .then(function () { Ace.busy(btn, false); });
  }

  /* ---------------- Import ---------------- */
  function openImport() { Ace.qs("#imp-text").value = ""; banner("imp-banner", null); Ace.Modal.open("modal-import"); }
  function importCsv() {
    var text = Ace.qs("#imp-text").value.trim();
    if (!text) { banner("imp-banner", "err", "Paste CSV rows or choose a file."); return; }
    var btn = Ace.qs("#imp-submit");
    Ace.busy(btn, true);
    banner("imp-banner", "info", "Verifying and importing… this can take a moment.");
    Ace.api.post("/api/accounts/import-csv", { csv_text: text })
      .then(function (d) {
        var errs = (d.errors || []).length;
        banner("imp-banner", d.imported ? "ok" : "warn",
          "Imported " + d.imported + " account(s)." + (errs ? " " + errs + " row(s) failed." : ""));
        if (d.imported) { Ace.toast("Import complete", d.imported + " account(s) added.", "ok"); if (Ace.pages && Ace.pages.reloadAccounts) Ace.pages.reloadAccounts(); }
      })
      .catch(function (e) { banner("imp-banner", "err", e.message || "Import failed."); })
      .then(function () { Ace.busy(btn, false); });
  }

  /* ---------------- Withdraw ---------------- */
  function openWithdraw(accountId) {
    if (!accountId && Ace.state.accounts.length) accountId = Ace.state.accounts[0].id;
    var acc = Ace.accountById(accountId);
    Ace.qs("#wd-acc-id").value = accountId || "";
    Ace.qs("#wd-acc").textContent = acc ? (acc.label || ("+" + acc.phone)) : "—";
    Ace.qs("#wd-bal").textContent = (acc ? (acc.balance || "0") : "0") + " GHS";
    Ace.qs("#wd-amount").value = "65";
    syncPills("wd-pills", 65);
    Ace.qs("#wd-pin").value = "";
    banner("wd-banner", null);
    Ace.Modal.open("modal-withdraw");
    if (accountId) {
      Ace.api.safe("/api/accounts/" + accountId + "/withdrawal-options", "withdrawalOptions").then(function (d) {
        if (!d || !d.withdrawal_amounts) return;
        var sel = Ace.qs("#wd-amount");
        var grid = Ace.qs("#wd-pills");
        if (sel) sel.innerHTML = d.withdrawal_amounts.map(function (v) { return '<option value="' + v + '">' + Ace.num(v) + ' GHS</option>'; }).join("");
        if (grid) grid.innerHTML = d.withdrawal_amounts.map(function (v) { return '<button type="button" data-amt="' + v + '" aria-pressed="false">' + v + '</button>'; }).join("");
        var first = d.withdrawal_amounts[0];
        if (sel) sel.value = String(first); syncPills("wd-pills", first);
        if (d.income_balance !== undefined) Ace.qs("#wd-bal").textContent = Number(d.income_balance).toFixed(2) + " GHS";
      }).catch(function () {});
    }
  }
  function submitWithdraw() {
    var id = Ace.qs("#wd-acc-id").value;
    var pin = Ace.qs("#wd-pin").value;
    if (!id) { banner("wd-banner", "err", "Select an account."); return; }
    if (!pin) { banner("wd-banner", "err", "Payment password is required."); return; }
    var btn = Ace.qs("#wd-submit");
    Ace.busy(btn, true);
    Ace.api.post("/api/accounts/" + id + "/withdraw", {
      amount: Number(Ace.qs("#wd-amount").value || 0),
      pay_password: pin,
      withdraw_wallet: Number(Ace.qs("#wd-wallet").value || 2)
    }).then(function (d) {
      banner("wd-banner", "ok", (d && d.message) || "Withdrawal submitted.");
      Ace.toast("Withdrawal", (d && d.message) || "Submitted.", "ok");
      if (Ace.pages && Ace.pages.reloadAccounts) Ace.pages.reloadAccounts();
    }).catch(function (e) { banner("wd-banner", "err", e.message || "Withdrawal failed."); })
      .then(function () { Ace.busy(btn, false); });
  }

  /* ---------------- History ---------------- */
  function openHistory(accountId) {
    var tbody = Ace.qs("#hist-rows");
    Ace.qs("#hist-title").textContent = accountId ? "Execution history — " + (Ace.accountById(accountId) || {}).label : "Execution history";
    tbody.innerHTML = '<tr><td colspan="6" class="table__empty">Loading…</td></tr>';
    Ace.Modal.open("modal-history");
    Ace.api.safe("/api/history" + (accountId ? ("?account_id=" + accountId) : "?limit=100"), "history").then(function (rows) {
      rows = rows || [];
      Ace.qs("#hist-count").textContent = rows.length;
      if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6" class="table__empty">No executions recorded yet.</td></tr>'; return; }
      tbody.innerHTML = rows.map(function (h) {
        var tone = Ace.statusTone(h.status);
        return '<tr><td class="mono">' + esc(Ace.stamp(h.run_time)) + '</td>' +
          '<td class="t-main">' + esc(h.label || h.phone) + '</td>' +
          '<td><span class="badge ' + Ace.toneBadge(tone) + ' badge--dot">' + esc(h.status || "—") + '</span></td>' +
          '<td class="t-right mono">' + Ace.num(h.tasks_done) + '</td>' +
          '<td class="t-right mono ' + (Number(h.earned) > 0 ? "text-ok" : "") + '">' + Ace.money(h.earned, true) + '</td>' +
          '<td class="t-right mono">' + esc(h.balance || "0") + '</td></tr>';
      }).join("");
    }).catch(function () { tbody.innerHTML = '<tr><td colspan="6" class="table__empty">Could not load history.</td></tr>'; });
  }

  /* ---------------- init ---------------- */
  function init() {
    var root = Ace.qs("#modal-root") || document.body;
    var holder = document.createElement("div");
    holder.innerHTML = markup();
    while (holder.firstChild) root.appendChild(holder.firstChild);
    Ace.Modal.init();

    Ace.on(Ace.qs("#acc-auto"), "change", toggleAutoFields);
    Ace.on(Ace.qs("#form-account"), "submit", function (e) { e.preventDefault(); saveAccount(); });
    Ace.on(Ace.qs("#form-account"), "keydown", function (e) {
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); saveAccount(); }
    });
    Ace.on(Ace.qs("#acc-save"), "click", saveAccount);
    Ace.on(Ace.qs("#acc-test"), "click", testLogin);
    wirePills("acc-pills", "acc-wamount");
    Ace.on(Ace.qs("#form-import"), "submit", function (e) { e.preventDefault(); importCsv(); });
    Ace.on(Ace.qs("#imp-submit"), "click", importCsv);
    Ace.on(Ace.qs("#imp-file"), "change", function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () { Ace.qs("#imp-text").value = r.result; };
      r.readAsText(f);
    });
    wirePills("wd-pills", "wd-amount");
    Ace.on(Ace.qs("#form-withdraw"), "submit", function (e) { e.preventDefault(); submitWithdraw(); });
    Ace.on(Ace.qs("#wd-submit"), "click", submitWithdraw);
  }

  Ace.modals = {
    init: init,
    openAccount: openAccount,
    openImport: openImport,
    openWithdraw: openWithdraw,
    openHistory: openHistory
  };
})();
