/**
 * Shell — page chrome shared by every page.
 * Applies the theme tokens and runs the sidebar clock, greeting and
 * sync indicator, so index.html and admin.html stay identical.
 */
class Shell {

  // ── Theme ─────────────────────────────────────────────────
  /**
   * Apply theme, accent color and sidebar width to the document root.
   * Pass an accent to override CONFIG.accent (used by the admin page).
   */
  static applyTheme(accent) {
    document.documentElement.dataset.theme = CONFIG.theme;
    document.documentElement.style.setProperty("--accent", accent || CONFIG.accent);
    document.documentElement.style.setProperty("--sidebar-width", CONFIG.sidebarWidth);
  }

  // ── Secondary-page boot ───────────────────────────────────
  /**
   * Boot the shared sidebar chrome for admin.html / docs.html.
   * opts: { accent, title, badge }
   */
  static bootSidebar(opts) {
    const o = opts || {};
    this.applyTheme(o.accent);
    this.#applyLabels(o.title, o.badge);
    this.startClock();
    this.setGreeting();
    this.updateSyncStatus();
  }

  static #applyLabels(title, badge) {
    const titleEl = document.getElementById("app-title");
    if (titleEl) titleEl.textContent = title || CONFIG.appName;

    const badgeEl = document.getElementById("app-badge");
    if (!badgeEl) return;
    if (badge) badgeEl.textContent = badge;
    else badgeEl.remove();
  }

  // ── Clock ─────────────────────────────────────────────────
  static startClock() {
    const timeEl = document.getElementById("time");
    const dateEl = document.getElementById("date");
    if (!timeEl || !dateEl) return;

    const tick = () => {
      const now = new Date();
      timeEl.textContent = this.#formatTime(now);
      dateEl.textContent = this.#formatDate(now);
    };

    tick();
    setInterval(tick, 10_000);
  }

  static #formatTime(d) {
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    if (CONFIG.clockFormat === "12h") {
      const hr = h % 12 || 12;
      const ampm = h < 12 ? "AM" : "PM";
      return `${hr}:${m} ${ampm}`;
    }
    return `${String(h).padStart(2, "0")}:${m}`;
  }

  static #formatDate(d) {
    const opts = { weekday: "long", month: "long", day: "numeric" };
    return d.toLocaleDateString("en-US", opts);
  }

  // ── Greeting ──────────────────────────────────────────────
  static setGreeting() {
    const el = document.getElementById("greeting");
    if (!el) return;
    const h = new Date().getHours();
    let phrase;
    if (h < 6) phrase = "Good night";
    else if (h < 12) phrase = "Good morning";
    else if (h < 18) phrase = "Good afternoon";
    else phrase = "Good evening";

    const name = CONFIG.userName || "";
    el.textContent = name ? `${phrase}, ${name}` : phrase;
  }

  // ── Sync status ───────────────────────────────────────────
  static async updateSyncStatus() {
    const dot = document.getElementById("sync-dot");
    const label = document.getElementById("sync-label");
    if (!dot || !label) return;

    const available = await FileStore.isServerAvailable();
    if (available) {
      dot.className = "sync-dot";
      label.textContent = "Auto-saved";
    } else {
      dot.className = "sync-dot offline";
      label.textContent = "Browser storage";
    }
  }
}
