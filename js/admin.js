/**
 * Daily Studio — Admin page entry point.
 * Boots the shared shell with the admin accent. Admin modules will
 * mount into #admin-canvas.
 */
(function () {
  "use strict";

  // ── Settings: page transition flood ───────────────────────
  // PageNav reads this flag on every click, so flipping it here takes
  // effect on the very next switch — no reload needed.
  function bindWipeToggle() {
    const btn = document.getElementById("toggle-wipe");
    if (!btn) return;

    function read() {
      try {
        const raw = localStorage.getItem(CONFIG.wipeEnabledKey);
        return raw === null ? CONFIG.wipeEnabled : raw === "1";
      } catch { return CONFIG.wipeEnabled; }
    }

    function paint(on) {
      btn.setAttribute("aria-checked", on ? "true" : "false");
    }

    paint(read());

    btn.addEventListener("click", () => {
      const next = btn.getAttribute("aria-checked") !== "true";
      paint(next);
      try { localStorage.setItem(CONFIG.wipeEnabledKey, next ? "1" : "0"); } catch { /* private mode */ }
    });
  }

  function init() {
    Shell.bootSidebar({ accent: CONFIG.adminAccent, badge: CONFIG.adminBadge });
    bindWipeToggle();

    // Expose for debugging / future extension
    window.__dsAdmin = { CONFIG };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
