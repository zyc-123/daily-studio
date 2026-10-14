/**
 * FileStore — automatic file-based persistence via local server API.
 *
 * When the app is served through server.js (http://localhost:3000),
 * data auto-saves to daily-studio-data.json in the project directory
 * on every change and auto-loads on page open — zero user interaction.
 *
 * When opened directly via file://, falls back to localStorage-only
 * (the Export button still works for manual backup).
 */
class FileStore {

  static _saveTimer = null;
  static _ltSaveTimer = null;
  static get SAVE_DEBOUNCE_MS() { return 300; }

  static _serverAvailable = null;

  // ── Public API ────────────────────────────────────────────

  /**
   * Check whether the local server API is reachable.
   * Success is cached; failure always retries (server may come back).
   */
  static async isServerAvailable() {
    if (this._serverAvailable === true) return true;
    try {
      const res = await fetch("/api/data");
      this._serverAvailable = res.ok;
    } catch {
      this._serverAvailable = false;
    }
    return this._serverAvailable;
  }

  /**
   * Always true — auto-save is always enabled (we try the server;
   * if unreachable, data stays safely in localStorage).
   */
  static isSyncActive() {
    return true;
  }

  /**
   * Load data from the server's JSON files into localStorage.
   * Call BEFORE components init so they read the merged data.
   * Returns true if server data was loaded.
   */
  static async restoreSync() {
    // Reset cache so we re-check on this page load
    this._serverAvailable = null;
    let loaded = false;

    try {
      const res = await fetch("/api/data");
      if (res.ok) {
        const data = await res.json();
        this._mergeIntoStorage(data);
        loaded = true;
        this._serverAvailable = true;
      }
    } catch { /* server not running */ }

    // Load long-term tasks from their own file
    try {
      const res = await fetch("/api/longterm");
      if (res.ok) {
        const tasks = await res.json();
        if (Array.isArray(tasks)) {
          localStorage.setItem(CONFIG.longtermStorageKey, JSON.stringify(tasks));
          loaded = true;
          this._serverAvailable = true;
        }
      }
    } catch { /* server not running */ }

    return loaded;
  }

  /**
   * Called by Storage after every save. Routes long-term data
   * to /api/longterm and everything else to /api/data.
   */
  static async onStorageSave(key) {
    if (key === CONFIG.longtermStorageKey) {
      // Long-term tasks → separate file
      if (this._ltSaveTimer) clearTimeout(this._ltSaveTimer);
      this._ltSaveTimer = setTimeout(async () => {
        this._ltSaveTimer = null;
        try {
          const raw = localStorage.getItem(CONFIG.longtermStorageKey);
          const tasks = raw ? JSON.parse(raw) : [];
          await fetch("/api/longterm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(tasks),
          });
        } catch { /* server not running */ }
      }, this.SAVE_DEBOUNCE_MS);
    } else {
      // Calendar / quicklinks / todos → main data file
      if (this._saveTimer) clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(async () => {
        this._saveTimer = null;
        try {
          const data = this._gatherAll();
          await fetch("/api/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          });
        } catch { /* server not running */ }
      }, this.SAVE_DEBOUNCE_MS);
    }
  }

  // ── Export (manual backup) ────────────────────────────────

  /** Download all app data as a JSON file (includes long-term). */
  static exportData() {
    const data = this._gatherAll();
    // Also include long-term tasks in the backup
    const ltRaw = localStorage.getItem(CONFIG.longtermStorageKey);
    if (ltRaw) {
      try { data[CONFIG.longtermStorageKey] = JSON.parse(ltRaw); } catch { /* skip */ }
    }
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().slice(0, 10);
    a.download = `daily-studio-backup-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this._setStatus("exported", "Exported ✓");
  }

  // ── Internal ──────────────────────────────────────────────

  static _gatherAll() {
    const data = {};
    // Main data keys only — long-term is persisted separately via /api/longterm
    const keys = [
      CONFIG.calendarStorageKey,
      CONFIG.quicklinksStorageKey,
      CONFIG.todoStorageKey,
      CONFIG.worklogStorageKey,
    ];
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try { data[key] = JSON.parse(raw); } catch { /* skip */ }
      }
    }
    data._exportedAt = new Date().toISOString();
    data._version = 1;
    return data;
  }

  static _mergeIntoStorage(data) {
    // Main data keys only — long-term is restored separately
    const keys = [
      CONFIG.calendarStorageKey,
      CONFIG.quicklinksStorageKey,
      CONFIG.todoStorageKey,
      CONFIG.worklogStorageKey,
    ];
    for (const key of keys) {
      if (data[key] !== undefined) {
        localStorage.setItem(key, JSON.stringify(data[key]));
      }
    }
  }

  static _setStatus(type, msg) {
    const el = document.getElementById("sync-label");
    if (!el) return;
    el.textContent = msg;
    if (type === "exported") {
      setTimeout(() => { el.textContent = "Auto-saved"; }, 3000);
    }
  }
}
