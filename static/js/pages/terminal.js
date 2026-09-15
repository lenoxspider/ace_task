/* ============================================================================
   Page · Live Terminal — full-height stream console
   ========================================================================== */
(function () {
  "use strict";
  var Ace = window.Ace;
  var stream = null;

  function init() {
    var host = Ace.qs("#term-full");
    if (!host) return;
    stream = Ace.stream.attach({ container: host, onAccountState: function () {} });
    if (!Ace.state.preview) stream.push("[SYSTEM] Console attached to /api/logs/stream. Awaiting events…");

    Ace.qsa("#term-toolbar [data-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        Ace.qsa("#term-toolbar [data-filter]").forEach(function (x) { x.setAttribute("aria-selected", "false"); });
        b.setAttribute("aria-selected", "true");
        stream.setFilter(b.dataset.filter);
      });
    });
    Ace.on(Ace.qs("#term-search"), "input", function (e) { stream.setSearch(e.target.value); });
    Ace.on(Ace.qs("#term-pause"), "click", function (e) {
      var on = stream.togglePause();
      e.currentTarget.setAttribute("aria-pressed", on ? "true" : "false");
      e.currentTarget.innerHTML = Ace.icon(on ? "play" : "pause", 14) + (on ? "Resume" : "Pause");
    });
    Ace.on(Ace.qs("#term-clear"), "click", function () { stream.clear(); });
    Ace.on(Ace.qs("#btn-jump"), "click", function () { host.scrollTop = host.scrollHeight; });
  }

  document.addEventListener("DOMContentLoaded", function () {
    Ace.shell.mount();
    Ace.modals.init();
    init();
  });
})();
