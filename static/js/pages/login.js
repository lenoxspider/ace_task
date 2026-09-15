/* ============================================================================
   Page · Login — master-password lock screen
   ========================================================================== */
(function () {
  "use strict";
  var Ace = window.Ace;

  function target() { return /\.html?$/i.test(location.pathname) ? "index.html" : "/"; }
  function fileMode() { return /\.html?$/i.test(location.pathname); }

  function init() {
    var form = Ace.qs("#login-form");
    var input = Ace.qs("#dash-password");
    var btn = Ace.qs("#btn-unlock");
    var banner = Ace.qs("#login-banner");
    var card = form;

    Ace.on(Ace.qs("#btn-eye"), "click", function (e) {
      var showing = input.type === "text";
      input.type = showing ? "password" : "text";
      e.currentTarget.innerHTML = Ace.icon(showing ? "eye" : "eyeOff", 17);
      input.focus();
    });

    Ace.on(form, "submit", function (e) {
      e.preventDefault();
      var pw = input.value.trim();
      if (!pw) return;
      Ace.busy(btn, true);
      banner.dataset.show = "false";
      card.classList.remove("shake");
      Ace.api.json("/api/auth/login", { method: "POST", body: JSON.stringify({ password: pw }) })
        .then(function (d) {
          if (d && d.token) { try { localStorage.setItem("ace_token", d.token); } catch (er) {} }
          Ace.qs("#btn-unlock-label").textContent = "Unlocked — redirecting…";
          location.href = target();
        })
        .catch(function (err) {
          if (fileMode() && err && err.name === "TypeError") {
            Ace.toast("No server", "Start the app (python app.py) and open the dashboard from http://localhost:8000.", "warn", 8000);
            Ace.busy(btn, false);
            return;
          }
          banner.className = "banner banner--err";
          banner.dataset.show = "true";
          banner.innerHTML = Ace.icon("xcircle", 16) + '<span>' + Ace.esc(err.message || "Incorrect password.") + '</span>';
          card.classList.add("shake");
          input.value = ""; input.focus();
          Ace.busy(btn, false);
          Ace.qs("#btn-unlock-label").textContent = "Unlock console";
        });
    });
  }

  // reveal form only if a server is present; in pure file preview we still show it
  document.addEventListener("DOMContentLoaded", function () {
    var ic = Ace.qs("#login-mark"); if (ic) ic.innerHTML = Ace.icon("bolt", 28);
    var eye = Ace.qs("#btn-eye"); if (eye) eye.innerHTML = Ace.icon("eye", 17);
    init();
  });
})();
