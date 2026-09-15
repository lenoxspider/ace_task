/* ============================================================================
   Boot — hydrates icon placeholders and route-aware links on every page.
   Load last so it runs after each page module has mounted the shell.
   ========================================================================== */
(function () {
  "use strict";
  var Ace = window.Ace;
  function hydrate() {
    Ace.qsa("[data-i]").forEach(function (el) {
      if (el.dataset.hydrated === "1") return;
      el.innerHTML = Ace.icon(el.dataset.i, el.dataset.size ? Number(el.dataset.size) : 16);
      el.dataset.hydrated = "1";
    });
    Ace.qsa("[data-preview-icon]").forEach(function (el) { el.innerHTML = Ace.icon("alert", 15); });
    Ace.qsa("[data-href-route]").forEach(function (a) {
      var page = a.dataset.hrefRoute.replace(/^\//, "") || "overview";
      a.href = Ace.shell.link(page);
    });
  }
  document.addEventListener("DOMContentLoaded", hydrate);
})();
