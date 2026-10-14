/**
 * QuickLinkSuggest — attaches a suggestion dropdown to URL inputs.
 *
 * Add class "ql-suggest-url" to any <input type="url"> to enable
 * quick-link suggestions on focus.  The dropdown shows up to 5 links
 * sorted by marked → most-used → name, filterable as the user types.
 *
 * Call QuickLinkSuggest.init() once after the page loads.
 */
class QuickLinkSuggest {

  static _dropdown = null;
  static _activeInput = null;
  static _selectedIdx = -1;

  /** Call once on app init. */
  static init() {
    // Focus-in: show dropdown on any .ql-suggest-url input
    document.addEventListener("focusin", (e) => {
      if (!e.target.matches(".ql-suggest-url")) return;
      this._activeInput = e.target;
      this._selectedIdx = -1;
      this._show(this._activeInput.value);
    });

    // Input: filter as user types
    document.addEventListener("input", (e) => {
      if (!e.target.matches(".ql-suggest-url")) return;
      if (this._activeInput !== e.target) return;
      this._selectedIdx = -1;
      this._show(e.target.value);
    });

    // Blur: hide (delay so click on suggestion registers first)
    document.addEventListener("focusout", (e) => {
      if (!e.target.matches(".ql-suggest-url")) return;
      setTimeout(() => {
        // Only hide if focus didn't move to the dropdown
        if (this._dropdown && !this._dropdown.contains(document.activeElement)) {
          this._hide();
        }
      }, 150);
    });

    // Keyboard navigation
    document.addEventListener("keydown", (e) => {
      if (!this._activeInput || !this._dropdown || this._dropdown.style.display === "none") return;

      const items = this._dropdown.querySelectorAll(".ql-sug-item");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this._selectedIdx = Math.min(this._selectedIdx + 1, items.length - 1);
        this._highlight(items);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this._selectedIdx = Math.max(this._selectedIdx - 1, -1);
        this._highlight(items);
      } else if (e.key === "Enter" && this._selectedIdx >= 0) {
        e.preventDefault();
        const sel = items[this._selectedIdx];
        if (sel && this._activeInput) {
          this._activeInput.value = sel.dataset.url;
          this._hide();
        }
      } else if (e.key === "Escape") {
        this._hide();
      }
    });

    // Click on suggestion
    document.addEventListener("click", (e) => {
      const item = e.target.closest(".ql-sug-item");
      if (!item || !this._activeInput) return;
      this._activeInput.value = item.dataset.url;
      this._hide();
    });
  }

  // ── Internal ──────────────────────────────────────────────

  static _show(query) {
    if (!this._activeInput) return;

    const suggestions = QuickLinksStorage.getSuggestions(query, 5);
    if (suggestions.length === 0) { this._hide(); return; }

    if (!this._dropdown) {
      this._dropdown = document.createElement("div");
      this._dropdown.className = "ql-suggest-dropdown";
      document.body.appendChild(this._dropdown);
    }

    this._dropdown.innerHTML = suggestions
      .map((l) => {
        const host = this._hostname(l.url);
        return `
        <div class="ql-sug-item" data-url="${this._escapeAttr(l.url)}">
          <span class="ql-sug-icon" style="background:${l.color || "#94a3b8"}">
            ${this._iconHTML(l)}
          </span>
          <span class="ql-sug-info">
            <span class="ql-sug-name">${this._escape(l.name)}</span>
            <span class="ql-sug-host">${host}</span>
          </span>
        </div>`;
      }).join("");

    // Position below the input
    const rect = this._activeInput.getBoundingClientRect();
    this._dropdown.style.top = `${rect.bottom + 4 + window.scrollY}px`;
    this._dropdown.style.left = `${rect.left + window.scrollX}px`;
    this._dropdown.style.minWidth = `${rect.width}px`;
    this._dropdown.style.display = "block";
  }

  static _hide() {
    if (this._dropdown) {
      this._dropdown.style.display = "none";
    }
    this._activeInput = null;
    this._selectedIdx = -1;
  }

  static _highlight(items) {
    items.forEach((el, i) => {
      el.classList.toggle("active", i === this._selectedIdx);
      if (i === this._selectedIdx) el.scrollIntoView({ block: "nearest" });
    });
  }

  static _hostname(url) {
    try { return new URL(url).hostname; } catch { return url; }
  }

  static _escape(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  static _escapeAttr(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
            .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  static _iconHTML(link) {
    const letter = (link.name || "?").charAt(0).toUpperCase();
    if (link.icon && link.icon.startsWith("data:")) {
      return `<img class="ql-sug-img" src="${this._escapeAttr(link.icon)}" alt="" />`;
    }
    if (link.icon && link.icon.startsWith("http")) {
      return `<img class="ql-sug-img" src="${this._escapeAttr(link.icon)}"
                onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
                alt="" /><span class="ql-sug-fb" style="display:none">${letter}</span>`;
    }
    const host = this._hostname(link.url);
    if (host) {
      return `<img class="ql-sug-img" src="https://www.google.com/s2/favicons?domain=${host}&sz=32"
                onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
                alt="" /><span class="ql-sug-fb" style="display:none">${letter}</span>`;
    }
    return `<span class="ql-sug-fb">${letter}</span>`;
  }
}
