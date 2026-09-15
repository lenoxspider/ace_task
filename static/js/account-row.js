/* ============================================================================
   Account row — shared renderer + actions (used by Overview & Accounts pages)
   ========================================================================== */
(function () {
  "use strict";
  var Ace = window.Ace;
  var esc = Ace.esc;

  function badgeWindow(acc) {
    var w = acc.effective_window || (acc.window_start && acc.window_end ? acc.window_start + "-" + acc.window_end : "");
    if (!w) return "";
    var def = acc.window_source === "default";
    return '<span class="badge badge--info" title="Task window (GMT)' + (def ? " — default window" : "") + '">' +
      Ace.icon("clock", 12) + esc(w) + (def ? " · def" : "") + '</span>';
  }

  function row(acc) {
    var running = Ace.isRunning(acc.id) || acc.last_status === "Running...";
    var paused = acc.enabled === 0;
    var tone = Ace.statusTone(paused ? "Paused" : acc.last_status);
    var initial = (acc.label || "A").charAt(0).toUpperCase();
    var today = Number(acc.earned_today || 0);
    var life = Number(acc.total_earned_ghs || 0);
    var withdrawnToday = acc.last_withdraw_date === Ace.todayStr();

    return '<div class="acct' + (paused ? " is-paused" : "") + (running ? " is-running" : "") + '" data-acct="' + acc.id + '">' +
      '<div class="acct__id">' +
        '<div class="avatar' + (running ? " avatar--running" : paused ? " avatar--paused" : "") + '">' + esc(initial) + '</div>' +
        '<div class="acct__meta">' +
          '<div class="acct__name"><b>' + esc(acc.label || "Account") + '</b>' +
            '<span class="badge badge--violet">' + esc(acc.vip_level || "VIP") + '</span>' +
            '<span class="badge">' + esc(String(acc.mode || "api").toUpperCase()) + '</span>' +
            badgeWindow(acc) +
            (running ? '<span class="badge badge--accent badge--dot">running</span>'
                     : paused ? '<span class="badge badge--warn">paused</span>'
                              : '<span class="badge badge--ok">active</span>') +
          '</div>' +
          '<span class="acct__phone">+' + esc(acc.phone) +
            '<button class="iconbtn" style="width:22px;height:22px" data-action="copy" title="Copy number" aria-label="Copy number">' + Ace.icon("copy", 12) + '</button>' +
          '</span>' +
          (acc.auto_withdraw === 1
            ? '<span class="dim" style="font-size:var(--fs-micro)">' + Ace.icon("cash", 11) +
              ' auto ' + (Number(acc.withdraw_amount) > 0 ? Ace.num(acc.withdraw_amount) + " GHS" : "full") +
              (withdrawnToday ? " · paid today" : " · ready 09:00–17:00") + '</span>'
            : "") +
        '</div>' +
      '</div>' +

      '<div class="acct__stats">' +
        '<div class="cell"><span class="cell__k">Balance</span><span class="cell__v">' + esc(acc.balance || "0") + ' <small>GHS</small></span></div>' +
        '<div class="cell"><span class="cell__k">Today</span><span class="cell__v text-ok">+' + Ace.money(today) + ' <small>GHS</small></span>' +
          '<span class="cell__k">' + Ace.num(acc.tasks_done_today) + ' tasks</span></div>' +
        '<div class="cell"><span class="cell__k">Lifetime</span><span class="cell__v">+' + Ace.money(life) + ' <small>GHS</small></span>' +
          '<span class="cell__k">' + Ace.num(acc.total_tasks_done) + ' all-time</span></div>' +
        '<div class="cell"><span class="cell__k">Last status</span>' +
          '<span class="cell__v"><span class="badge ' + Ace.toneBadge(tone) + ' badge--dot">' + esc(acc.last_status || "never run") + '</span></span></div>' +
      '</div>' +

      '<div class="acct__actions">' +
        (paused
          ? '<button class="btn btn--sm" data-action="resume">' + Ace.icon("play", 14) + 'Resume</button>'
          : '<button class="btn btn--sm btn--primary" data-action="run"' + (running ? " disabled" : "") + '>' +
              Ace.icon("play", 14) + (running ? "Running" : "Run") + '</button>' +
            '<button class="iconbtn" data-action="pause" title="Pause automation">' + Ace.icon("pause", 14) + '</button>') +
        '<button class="iconbtn" data-action="refresh" title="Refresh balance">' + Ace.icon("refresh", 14) + '</button>' +
        '<button class="iconbtn" data-action="withdraw" title="Request withdrawal">' + Ace.icon("cash", 14) + '</button>' +
        '<button class="iconbtn" data-action="history" title="Execution history">' + Ace.icon("scroll", 14) + '</button>' +
        '<button class="iconbtn" data-action="edit" title="Edit account">' + Ace.icon("edit", 14) + '</button>' +
        '<button class="iconbtn iconbtn--danger" data-action="delete" title="Delete account">' + Ace.icon("trash", 14) + '</button>' +
      '</div>' +
    '</div>';
  }

  function empty(msg, cta) {
    return '<div class="empty"><div class="empty__icon">' + Ace.icon("users", 22) + '</div>' +
      '<b>' + esc(msg) + '</b>' + (cta ? '<p>' + esc(cta) + '</p>' : "") + '</div>';
  }

  function render(container, list, emptyMsg, emptyCta) {
    if (!container) return;
    if (!list.length) { container.innerHTML = empty(emptyMsg || "No accounts", emptyCta); return; }
    container.innerHTML = list.map(row).join("");
  }

  /* ---------------- actions ---------------- */
  function reload(full) {
    if (Ace.pages && Ace.pages.reloadAccounts) Ace.pages.reloadAccounts();
    if (full && Ace.pages && Ace.pages.reloadStats) Ace.pages.reloadStats();
  }

  function handle(action, id, btn) {
    var acc = Ace.accountById(id);
    if (action === "copy") {
      var txt = acc ? acc.phone : "";
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { Ace.toast("Copied", "+233 " + txt, "info", 2000); });
      return;
    }
    if (action === "edit") { Ace.modals.openAccount(id); return; }
    if (action === "withdraw") { Ace.modals.openWithdraw(id); return; }
    if (action === "history") { Ace.modals.openHistory(id); return; }
    if (action === "delete") {
      if (!confirm("Delete this account permanently?")) return;
      Ace.api.del("/api/accounts/" + id)
        .then(function () { Ace.toast("Deleted", "Account removed.", "warn"); reload(true); })
        .catch(function (e) { Ace.toast("Delete failed", e.message, "err"); });
      return;
    }
    if (action === "run") {
      Ace.busy(btn, true);
      Ace.api.post("/api/accounts/" + id + "/run")
        .then(function () { Ace.toast("Run started", "Account #" + id + " queued.", "ok"); reload(); })
        .catch(function (e) { Ace.toast("Cannot run", e.message, "err"); Ace.busy(btn, false); });
      return;
    }
    if (action === "pause" || action === "resume") {
      Ace.busy(btn, true);
      Ace.api.post("/api/accounts/" + id + "/toggle-pause")
        .then(function (d) {
          Ace.toast(d && d.is_paused ? "Paused" : "Resumed", "Automation " + (d && d.is_paused ? "paused" : "resumed") + ".", d && d.is_paused ? "warn" : "ok");
          reload();
        })
        .catch(function (e) { Ace.toast("Action failed", e.message, "err"); Ace.busy(btn, false); });
      return;
    }
    if (action === "refresh") {
      Ace.busy(btn, true);
      var ic = btn.innerHTML; btn.innerHTML = Ace.icon("refresh", 14);
      btn.querySelector("svg").classList.add("spin");
      Ace.api.post("/api/accounts/" + id + "/refresh-balance")
        .then(function (d) {
          Ace.toast("Balance synced", (d.label || d.phone) + " → " + (d.balance || "0") + " GHS · VIP " + (d.vip_level || "?"), "ok");
          reload(true);
        })
        .catch(function (e) { Ace.toast("Refresh failed", e.message, "err"); Ace.busy(btn, false); btn.innerHTML = ic; });
    }
  }

  function bind(root) {
    (root || document).addEventListener("click", function (e) {
      var b = e.target.closest("[data-action]");
      if (!b) return;
      var wrap = b.closest("[data-acct]");
      if (!wrap) return;
      e.preventDefault();
      handle(b.dataset.action, Number(wrap.dataset.acct), b);
    });
  }

  Ace.accountRow = row;
  Ace.accountRender = render;
  Ace.bindAccountActions = bind;
  Ace.accountActions = handle;
})();
