/**
 * Daily Studio — Docs page entry point.
 * Boots the shared shell with the wine accent. Doc modules will
 * mount into #docs-canvas.
 */
(function () {
  "use strict";

  function init() {
    Shell.bootSidebar({ accent: CONFIG.docsAccent, badge: CONFIG.docsBadge });
    DocsShelves.init("docs-shelves");

    // Expose for debugging / future extension
    window.__dsDocs = { CONFIG };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
