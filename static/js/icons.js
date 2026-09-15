/* ============================================================================
   Icons — inline SVG line set (no emoji, no icon-font dependency)
   Usage:  Ace.icon('play')            -> svg string, currentColor
           Ace.icon('play', 18)        -> sized
   ========================================================================== */
(function () {
  "use strict";

  // Each entry is the inner markup of a 24x24 viewBox line icon.
  var P = {
    bolt: '<path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l1-8Z"/>',
    gauge: '<path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="M13.4 12.6 19 7"/><path d="M3.5 19a9 9 0 1 1 17 0"/>',
    users: '<path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20"/><circle cx="9.5" cy="7" r="3.2"/><path d="M21 20v-1.5a4 4 0 0 0-3-3.87"/><path d="M15.5 4.2a3.2 3.2 0 0 1 0 6"/>',
    terminal: '<rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="m7 9 3 3-3 3"/><path d="M12.5 15H17"/>',
    cash: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
    scroll: '<path d="M6 3h9l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5"/><path d="M8.5 12.5h7M8.5 16h5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 6.6l1.9 1.1M17.9 16.3l1.9 1.1M4.2 17.4l1.9-1.1M17.9 7.7l1.9-1.1"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 15V3"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15"/>',
    download: '<path d="M12 3v12"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15"/>',
    play: '<path d="M7 4.5v15l12-7.5-12-7.5Z"/>',
    pause: '<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-13.6-4.6L4 8.5"/><path d="M4 4.5v4h4"/><path d="M4 13a8 8 0 0 0 13.6 4.6L20 15.5"/><path d="M20 19.5v-4h-4"/>',
    edit: '<path d="M4 20h4l10-10a2.4 2.4 0 0 0-3.4-3.4L4.6 16.6 4 20Z"/><path d="m13.5 7.5 3 3"/>',
    trash: '<path d="M4 6.5h16"/><path d="M9 6.5V4.8A1.3 1.3 0 0 1 10.3 3.5h3.4A1.3 1.3 0 0 1 15 4.8v1.7"/><path d="M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.4-3.4"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m4.5 12.5 5 5 10-11"/>',
    alert: '<path d="M12 3.5 21 19H3l9-15.5Z"/><path d="M12 10v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    xcircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    checkcircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
    chevronRight: '<path d="m9 5 7 7-7 7"/>',
    chevronLeft: '<path d="m15 5-7 7 7 7"/>',
    arrowRight: '<path d="M4 12h15"/><path d="m13 6 6 6-6 6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    moon: '<path d="M20 13.5A8 8 0 0 1 10.5 4a8.2 8.2 0 1 0 9.5 9.5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
    contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18Z" fill="currentColor" stroke="none"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
    shield: '<path d="M12 3 5 6v5.5c0 4.3 2.9 7.8 7 9 4.1-1.2 7-4.7 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4.5"/>',
    send: '<path d="M21 4 3 11l7 2.5L12.5 21 21 4Z"/><path d="m10 13.5 3.5-3.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m4.5 12.5 7.5 4.2 7.5-4.2"/><path d="m4.5 16.5 7.5 4.2 7.5-4.2"/>',
    activity: '<path d="M3 12h3.5l2.5 6 4-14 2.5 8H21"/>',
    wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a2 2 0 0 1 2 2v1"/><rect x="4" y="7.5" width="16" height="11" rx="2.5"/><path d="M16 13h.01"/>',
    trend: '<path d="m4 15 5-5 3.5 3.5L20 6"/><path d="M15 6h5v5"/>',
    key: '<circle cx="8" cy="14" r="3.5"/><path d="m10.5 11.5 8-8"/><path d="m16 6 2 2M18.5 3.5l2 2"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
    filter: '<path d="M3.5 5h17l-6.5 8v5.5l-4 1.5V13L3.5 5Z"/>',
    key2: '<circle cx="12" cy="9" r="4"/><path d="M9.5 12.5 8 21l4-2 4 2-1.5-8.5"/>',
    database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M4 4l16 16"/><path d="M9.5 9.7A3 3 0 0 0 12 15c.8 0 1.6-.3 2.2-.9"/><path d="M6.2 6.6C4 8.2 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1"/><path d="M9.8 5.8A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 4"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    wifi: '<path d="M3 9.5a13 13 0 0 1 18 0"/><path d="M6 13a9 9 0 0 1 12 0"/><path d="M9 16.5a4.5 4.5 0 0 1 6 0"/><path d="M12 20h.01"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4.5A2.5 2.5 0 0 1 15.5 21h-9A2.5 2.5 0 0 1 4 18.5v-9A2.5 2.5 0 0 1 6.5 7H11"/>',
    logout: '<path d="M15 4h3.5A2.5 2.5 0 0 1 21 6.5v11A2.5 2.5 0 0 1 18.5 20H15"/><path d="M10 8 6 12l4 4"/><path d="M6 12h9"/>'
  };

  function icon(name, size) {
    var body = P[name] || P.info;
    var s = size || 18;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  window.Ace = window.Ace || {};
  window.Ace.icon = icon;
  window.Ace.icons = P;
})();
