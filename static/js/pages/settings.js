/* ============================================================================
   Page · Settings — scheduler, Telegram, platform, windows, system updates
   ========================================================================== */
(function () {
  "use strict";
  var Ace = window.Ace;
  var esc = Ace.esc;

  var TABS = ["working-hours", "midnight", "pacing", "telegram", "platform", "windows", "system"];

  function switchTab(id) {
    TABS.forEach(function (t) {
      var panel = Ace.qs("#tab-" + t);
      var btn = Ace.qs("[data-tab=" + t + "]");
      if (panel) panel.hidden = (t !== id);
      if (btn) btn.setAttribute("aria-selected", t === id ? "true" : "false");
    });
  }

  function loadSettings() {
    return Ace.api.safe("/api/settings", "settings").then(function (s) {
      if (!s) return;
      setVal("#set-time", s.schedule_time);
      setCheck("#set-auto-retry", s.auto_retry_outside_hours === "1");
      setVal("#set-retry-interval", s.retry_interval_minutes);
      setCheck("#set-midnight", s.midnight_scheduler_enabled === "1");
      setVal("#set-min-task", s.min_task_spacing_minutes);
      setVal("#set-max-task", s.max_task_spacing_minutes);
      setVal("#set-min-wd", s.min_withdrawal_spacing_minutes);
      setVal("#set-max-wd", s.max_withdrawal_spacing_minutes);
      setVal("#set-tg-token", s.telegram_token);
      setVal("#set-tg-chat", s.telegram_chat_id);
      setVal("#set-base-url", s.base_url);
      setVal("#set-def-start", s.default_window_start);
      setVal("#set-def-end", s.default_window_end);
      setVal("#set-slot-dur", s.slot_duration_minutes);
      setVal("#set-cutoff", s.late_run_cutoff);
      setVal("#set-policy", s.missed_window_policy);
    }).catch(function () {});
  }
  function setVal(sel, v) { var e = Ace.qs(sel); if (e && v !== undefined && v !== null) e.value = String(v); }
  function setCheck(sel, on) { var e = Ace.qs(sel); if (e) e.checked = !!on; }

  function collect() {
    return {
      schedule_time: val("#set-time"),
      auto_retry_outside_hours: Ace.qs("#set-auto-retry").checked ? "1" : "0",
      retry_interval_minutes: val("#set-retry-interval"),
      midnight_scheduler_enabled: Ace.qs("#set-midnight").checked ? "1" : "0",
      min_task_spacing_minutes: val("#set-min-task"),
      max_task_spacing_minutes: val("#set-max-task"),
      min_withdrawal_spacing_minutes: val("#set-min-wd"),
      max_withdrawal_spacing_minutes: val("#set-max-wd"),
      telegram_token: val("#set-tg-token"),
      telegram_chat_id: val("#set-tg-chat"),
      base_url: val("#set-base-url"),
      default_window_start: val("#set-def-start"),
      default_window_end: val("#set-def-end"),
      slot_duration_minutes: val("#set-slot-dur"),
      late_run_cutoff: val("#set-cutoff"),
      missed_window_policy: val("#set-policy")
    };
  }
  function val(sel) { var e = Ace.qs(sel); return e ? e.value.trim() : ""; }

  function save() {
    var btn = Ace.qs("#btn-save");
    Ace.busy(btn, true);
    Ace.api.post("/api/settings", collect())
      .then(function () { Ace.toast("Saved", "Settings and scheduler updated.", "ok"); Ace.shell.refreshScheduler(); })
      .catch(function (e) { Ace.toast("Save failed", e.message, "err"); })
      .then(function () { Ace.busy(btn, false); });
  }

  function testTelegram() {
    var btn = Ace.qs("#btn-tg-test");
    Ace.busy(btn, true);
    Ace.api.post("/api/settings/test-telegram", { telegram_token: val("#set-tg-token"), telegram_chat_id: val("#set-tg-chat") })
      .then(function () { Ace.toast("Telegram OK", "Test message delivered.", "ok"); })
      .catch(function (e) { Ace.toast("Telegram failed", e.message, "err"); })
      .then(function () { Ace.busy(btn, false); });
  }

  /* ---------------- Windows plan ---------------- */
  function loadPlan() {
    var host = Ace.qs("#plan-body");
    if (!host) return;
    host.innerHTML = '<div class="dim">Loading window plan…</div>';
    Ace.api.safe("/api/windows/plan", "plan").then(function (d) {
      if (!d) { host.innerHTML = '<div class="dim">No plan available.</div>'; return; }
      var meta = 'Spacing ' + (d.spacing_minutes || 15) + ' min · slot ' + (d.slot_duration_minutes || 10) + ' min · cutoff ' + (d.late_run_cutoff || "23:00");
      var html = '<div class="dim" style="font-size:var(--fs-xs);margin-bottom:10px">' + esc(meta) + '</div>';
      (d.windows || []).forEach(function (w) {
        var names = w.accounts.map(function (a) { return esc(a.label) + (a.late ? ' <span class="badge badge--warn">late</span>' : ""); }).join(", ");
        html += '<div class="panel" style="background:var(--ink-900);margin-bottom:8px"><div class="panel__body" style="display:flex;gap:10px;align-items:flex-start;padding:12px">' +
          '<span class="badge ' + (w.ok ? "badge--ok" : "badge--warn") + '">' + (w.ok ? "ok" : "tight") + '</span>' +
          '<div style="min-width:0"><b style="font-family:var(--font-mono);font-size:var(--fs-sm)">' + esc(w.window) + '</b>' +
          '<div class="dim" style="font-size:var(--fs-xs);margin-top:2px">' + (names || '<span class="dim">—</span>') + '</div>' +
          '<div class="dim" style="font-size:var(--fs-micro);margin-top:2px">' + w.count + ' account(s) · capacity ' + w.capacity + '</div></div></div></div>';
      });
      (d.problems || []).forEach(function (p) { html += '<div class="banner banner--warn" data-show="true">' + Ace.icon("alert", 15) + '<span>' + esc(String(p)) + '</span></div>'; });
      host.innerHTML = html;
    }).catch(function () { host.innerHTML = '<div class="dim">Could not load plan.</div>'; });
  }

  /* ---------------- System ---------------- */
  function loadVersion() {
    Ace.api.safe("/api/system/version", "version").then(function (v) {
      if (!v) return;
      setVal("#sys-commit", (v.branch || "") + " · " + (v.commit || ""));
      var meta = Ace.qs("#sys-meta");
      if (meta) meta.textContent = (v.subject || "") + (v.date ? " — " + v.date : "") + (v.dirty ? " · dirty" : "");
    }).catch(function () {});
  }
  function sysOut(text) {
    var pre = Ace.qs("#sys-out");
    if (!pre) return;
    pre.hidden = false;
    pre.textContent = text;
  }
  function checkUpdates() {
    var btn = Ace.qs("#btn-sys-check");
    Ace.busy(btn, true);
    Ace.api.json("/api/system/version?check=true").then(function (v) {
      sysOut("Branch " + (v.branch || "") + " · " + (v.commit || "") + "\nBehind: " + (v.behind || 0) + " · Ahead: " + (v.ahead || 0));
    }).catch(function (e) { sysOut("Check failed: " + e.message); })
      .then(function () { Ace.busy(btn, false); });
  }
  function update() {
    var pw = Ace.qs("#sys-pw").value;
    if (!pw) { Ace.toast("Password required", "Enter the master password.", "warn"); return; }
    var btn = Ace.qs("#btn-sys-update");
    Ace.busy(btn, true);
    sysOut("Pulling latest code…");
    Ace.api.post("/api/system/update", { password: pw, restart: true })
      .then(function (d) { sysOut((d.output || "") + "\n\nRestarting: " + (d.restarting ? "yes" : "manual")); Ace.toast("Update", d.updated ? "Updated & restarting." : "Already up to date.", d.updated ? "ok" : "info"); })
      .catch(function (e) { sysOut("Update failed: " + e.message); })
      .then(function () { Ace.busy(btn, false); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    Ace.shell.mount();
    Ace.modals.init();
    Ace.on(Ace.qs("#settings-form"), "submit", function (e) { e.preventDefault(); save(); });
    Ace.qsa("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { switchTab(b.dataset.tab); }); });
    Ace.on(Ace.qs("#btn-save"), "click", save);
    Ace.on(Ace.qs("#btn-tg-test"), "click", testTelegram);
    Ace.on(Ace.qs("#btn-plan-refresh"), "click", loadPlan);
    Ace.on(Ace.qs("#btn-sys-check"), "click", checkUpdates);
    Ace.on(Ace.qs("#btn-sys-update"), "click", update);
    switchTab("working-hours");
    loadSettings();
    loadPlan();
    loadVersion();
  });
})();
