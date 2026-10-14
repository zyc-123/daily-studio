/**
 * Thin wrapper over localStorage with JSON serialization.
 * Falls back to an in-memory store when localStorage is unavailable.
 */
class Storage {
  static #memory = new Map();
  static #onSaveHooks = [];

  /** Register a callback fired after every save. */
  static onSave(fn) {
    this.#onSaveHooks.push(fn);
  }

  static #available() {
    try {
      const key = "__ds_test__";
      localStorage.setItem(key, "1");
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save a value under `key`. Objects are JSON-serialized.
   */
  static save(key, data) {
    const json = JSON.stringify(data);
    if (this.#available()) {
      localStorage.setItem(key, json);
    } else {
      this.#memory.set(key, json);
    }
    // Notify hooks (debounced file sync, etc.)
    for (const fn of this.#onSaveHooks) {
      try { fn(key, data); } catch { /* never let a hook break the save */ }
    }
  }

  /**
   * Load a value by `key`. Returns `defaultValue` when the key
   * is missing or parsing fails.
   */
  static load(key, defaultValue = null) {
    let raw;
    if (this.#available()) {
      raw = localStorage.getItem(key);
    } else {
      raw = this.#memory.get(key) ?? null;
    }

    if (raw === null || raw === undefined) return defaultValue;

    try {
      return JSON.parse(raw);
    } catch {
      return defaultValue;
    }
  }

  /**
   * Remove a key.
   */
  static remove(key) {
    if (this.#available()) {
      localStorage.removeItem(key);
    } else {
      this.#memory.delete(key);
    }
  }
}
