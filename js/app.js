/**
 * Daily Studio — Application entry point.
 * Orchestrates shell chrome and component init.
 */
(function () {
  "use strict";

  // ── Stats listener ────────────────────────────────────────
  function bindStats() {
    const el = document.getElementById("stats");
    if (!el) return;

    document.addEventListener("todolist:stats", (e) => {
      const { total, remaining, done } = e.detail;
      if (total === 0) {
        el.innerHTML = `<span class="stat-label">No tasks yet</span>`;
      } else if (remaining === 0) {
        el.innerHTML = `<span class="stat-label">All done!</span>
                        <span class="stat-detail">${done} completed</span>`;
      } else {
        el.innerHTML = `<span class="stat-number">${remaining}</span>
                        <span class="stat-label">remaining</span>
                        <span class="stat-detail">${done} of ${total} done</span>`;
      }
    });
  }

  // ── Resize handle ──────────────────────────────────────
  function initResizeHandle() {
    const handle = document.getElementById("resize-handle");
    const panel = document.getElementById("longterm-section");
    if (!handle || !panel) return;

    const STORAGE_KEY = "ds_lt_panel_width";
    const MIN = 160;
    const MAX = 500;

    // Restore saved width
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) panel.style.width = Math.max(MIN, Math.min(MAX, Number(saved))) + "px";

    let dragging = false;
    let startX = 0;
    let startW = 0;

    handle.addEventListener("mousedown", (e) => {
      dragging = true;
      startX = e.clientX;
      startW = panel.getBoundingClientRect().width;
      handle.classList.add("active");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = startX - e.clientX; // leftward = wider panel
      const newW = Math.max(MIN, Math.min(MAX, startW + dx));
      panel.style.width = newW + "px";
    });

    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const w = parseInt(panel.style.width);
      if (w) localStorage.setItem(STORAGE_KEY, w);
    });
  }

  // ── Init ──────────────────────────────────────────────────
  async function init() {
    Shell.applyTheme();
    Shell.startClock();
    Shell.setGreeting();
    bindStats();

    // ── File sync ─────────────────────────────────────────
    await FileStore.restoreSync();
    Storage.onSave((key) => FileStore.onStorageSave(key));
    Shell.updateSyncStatus();

    // ── Components ────────────────────────────────────────
    const cal = new Calendar("calendar-panel", "day-editor-section");
    cal.init();

    const worklog = new WorkLog("worklog-section");
    worklog.init();

    const ql = new QuickLinks("quicklinks-section");
    ql.init();

    QuickLinkSuggest.init();

    const lt = new LongTerm("longterm-section");
    lt.init();

    // Listen for long-term scheduling changes → refresh calendar
    document.addEventListener("longterm:changed", () => {
      cal.refresh();
      lt.refresh();
    });

    // Emit today's stats on load
    const todayStats = cal.getTodayStats();
    document.dispatchEvent(
      new CustomEvent("todolist:stats", { detail: todayStats, bubbles: true })
    );

    // ── Resizable long-term panel ─────────────────────────
    initResizeHandle();

    // ── Export button ─────────────────────────────────────
    const exportBtn = document.getElementById("data-export");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => FileStore.exportData());
    }

    // Expose for debugging / future extension
    window.__ds = { cal, worklog, ql, lt, CONFIG };
  }

  // Wait for DOM + config
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
