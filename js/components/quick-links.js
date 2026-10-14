/**
 * QuickLinks — manage frequently-visited tools/pages.
 *
 * Located below the calendar in the right panel.
 * Each link: name, url, color, icon (upload or auto-favicon), marked/not.
 * Sorted: marked first, then alphabetically by name.
 *
 * Usage:
 *   const ql = new QuickLinks("quicklinks-root");
 *   ql.init();
 */
class QuickLinks {
  constructor(rootId) {
    this.root = document.getElementById(rootId);
    this.links = [];
    this.editingId = null;   // null=closed, -1=new, >0=editing existing id
  }

  // ── Public ────────────────────────────────────────────────

  init() {
    this.links = QuickLinksStorage.loadAll();
    this.#render();
    this.#bindEvents();
  }

  // ── Helpers ───────────────────────────────────────────────

  #persist() {
    QuickLinksStorage.saveAll(this.links);
  }

  #nextId() {
    return this.links.length > 0
      ? Math.max(...this.links.map((l) => l.id)) + 1
      : 1;
  }

  #escape(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  #escapeAttr(str) {
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
              .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /** Extract hostname from a URL for the auto-favicon fallback. */
  #hostname(url) {
    try { return new URL(url).hostname; } catch { return ""; }
  }

  /** Fallback: read a file as base64 data URL (when server is unavailable). */
  #readAsBase64(file, targetInput) {
    const reader = new FileReader();
    reader.onload = () => { targetInput.value = reader.result; };
    reader.readAsDataURL(file);
  }

  /** Sorted copy: marked first → most-used → name A–Z. */
  #sorted() {
    return [...this.links].sort((a, b) => {
      if (a.marked !== b.marked) return a.marked ? -1 : 1;
      const ucA = a.useCount || 0;
      const ucB = b.useCount || 0;
      if (ucA !== ucB) return ucB - ucA;
      return a.name.localeCompare(b.name);
    });
  }

  // ── Rendering ─────────────────────────────────────────────

  #render() {
    if (!this.root) return;
    const sorted = this.#sorted();
    const listHTML = sorted.length === 0
      ? `<div class="ql-empty">No links yet. Click + to add one.</div>`
      : sorted.map((l) => this.#cardHTML(l)).join("");

    this.root.innerHTML = `
      <div class="ql-header">
        <h3 class="ql-title">Quick Links</h3>
        <button class="ql-add-btn" title="Add link">+</button>
      </div>
      <div class="ql-list">${listHTML}</div>
      ${this.editingId !== null ? this.#formHTML() : ""}`;
  }

  #cardHTML(link) {
    const iconHTML = this.#iconHTML(link);
    return `
      <a class="ql-card" href="${this.#escapeAttr(link.url)}"
         target="_blank" rel="noopener" title="${this.#escape(link.url)}"
         data-id="${link.id}">
        <span class="ql-icon-wrap" style="--ql-color:${link.color || "#94a3b8"}">
          ${iconHTML}
        </span>
        <span class="ql-info">
          <span class="ql-name">${this.#escape(link.name)}</span>
          <span class="ql-url">${this.#escape(this.#hostname(link.url))}</span>
        </span>
        <span class="ql-actions">
          <button class="ql-star ${link.marked ? "ql-starred" : ""}"
            data-action="mark" title="${link.marked ? "Unmark" : "Mark"}">
            <svg viewBox="0 0 24 24" fill="${link.marked ? "currentColor" : "none"}"
                 stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
          <button class="ql-edit-btn" data-action="edit" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button class="ql-del-btn" data-action="delete" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      </a>`;
  }

  #iconHTML(link) {
    const letter = link.name.charAt(0).toUpperCase();
    if (link.icon && link.icon.startsWith("/icons/")) {
      return `<img class="ql-icon-img" src="${this.#escapeAttr(link.icon)}" alt="" />`;
    }
    if (link.icon && link.icon.startsWith("data:")) {
      return `<img class="ql-icon-img" src="${this.#escapeAttr(link.icon)}" alt="" />`;
    }
    if (link.icon && link.icon.startsWith("http")) {
      return `<img class="ql-icon-img" src="${this.#escapeAttr(link.icon)}"
                onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
                alt="" /><span class="ql-fallback" style="display:none">${letter}</span>`;
    }
    // Auto-favicon from Google
    const host = this.#hostname(link.url);
    if (host) {
      const faviconUrl = `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
      return `<img class="ql-icon-img" src="${faviconUrl}"
                onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
                alt="" /><span class="ql-fallback" style="display:none">${letter}</span>`;
    }
    return `<span class="ql-fallback">${letter}</span>`;
  }

  // ── Add / Edit form ───────────────────────────────────────

  #formHTML() {
    const link = this.editingId > 0
      ? this.links.find((l) => l.id === this.editingId)
      : null;

    const isEdit = link !== undefined && link !== null;
    const name = link ? link.name : "";
    const url = link ? link.url : "";
    const color = link ? (link.color || "#0d9488") : "#0d9488";
    const iconVal = link ? (link.icon || "") : "";
    const marked = link ? link.marked : false;

    const presets = ["#ef4444","#f59e0b","#22c55e","#0d9488","#3b82f6","#8b5cf6","#ec4899","#94a3b8"];

    return `
      <div class="ql-form">
        <div class="ql-form-title">${isEdit ? "Edit Link" : "New Link"}</div>

        <input class="ql-input ql-input-name" type="text"
          placeholder="Name" value="${this.#escapeAttr(name)}" />

        <input class="ql-input ql-input-url" type="url"
          placeholder="https://…" value="${this.#escapeAttr(url)}" />

        <div class="ql-color-row">
          ${presets.map((c) => `
            <button class="ql-color-swatch ${color === c ? "active" : ""}"
              data-color="${c}" style="background:${c}" title="${c}"></button>
          `).join("")}
          <input class="ql-color-custom" type="color" value="${color}"
            title="Custom color" />
        </div>

        <div class="ql-icon-row">
          <label class="ql-icon-upload" title="Upload icon image">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 width="16" height="16">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <input class="ql-file-input" type="file" accept="image/*" />
          </label>
          <input class="ql-input ql-input-iconurl" type="url"
            placeholder="or icon URL…" value="${this.#escapeAttr(iconVal)}" />
        </div>

        <label class="ql-mark-row">
          <input class="ql-input-marked" type="checkbox" ${marked ? "checked" : ""} />
          <span>Marked (show first)</span>
        </label>

        <div class="ql-form-btns">
          <button class="ql-form-save">${isEdit ? "Save" : "Add"}</button>
          <button class="ql-form-cancel">Cancel</button>
        </div>
      </div>`;
  }

  // ── CRUD ──────────────────────────────────────────────────

  #addLink(data) {
    if (this.links.length >= CONFIG.quicklinksMaxItems) return;
    this.links.push({
      id: this.#nextId(),
      name: data.name.trim(),
      url: data.url.trim(),
      color: data.color,
      icon: data.icon || "",
      marked: data.marked,
      useCount: 0,
      createdAt: new Date().toISOString(),
    });
    this.#persist();
    this.editingId = null;
    this.#render();
  }

  #updateLink(id, data) {
    const link = this.links.find((l) => l.id === id);
    if (!link) return;
    Object.assign(link, {
      name: data.name.trim(),
      url: data.url.trim(),
      color: data.color,
      icon: data.icon !== undefined ? data.icon : link.icon,
      marked: data.marked,
    });
    this.#persist();
    this.editingId = null;
    this.#render();
  }

  #deleteLink(id) {
    this.links = this.links.filter((l) => l.id !== id);
    this.#persist();
    if (this.editingId === id) this.editingId = null;
    this.#render();
  }

  #toggleMark(id) {
    const link = this.links.find((l) => l.id === id);
    if (!link) return;
    link.marked = !link.marked;
    this.#persist();
    this.#render();
  }

  // ── Events ────────────────────────────────────────────────

  #bindEvents() {
    // Delegated click on the root
    this.root.addEventListener("click", (e) => {
      // Add button
      if (e.target.closest(".ql-add-btn")) {
        this.editingId = -1; // new link
        this.#render();
        return;
      }

      // Cancel form
      if (e.target.closest(".ql-form-cancel")) {
        this.editingId = null;
        this.#render();
        return;
      }

      // Save form
      if (e.target.closest(".ql-form-save")) {
        this.#saveForm();
        return;
      }

      // Color swatch
      const swatch = e.target.closest(".ql-color-swatch");
      if (swatch) {
        const customInput = this.root.querySelector(".ql-color-custom");
        if (customInput) customInput.value = swatch.dataset.color;
        this.root.querySelectorAll(".ql-color-swatch").forEach((s) => s.classList.remove("active"));
        swatch.classList.add("active");
        return;
      }

      // Card actions (mark, edit, delete) — prevent link navigation
      const action = e.target.closest("[data-action]");
      if (action) {
        e.preventDefault();
        const card = action.closest(".ql-card");
        const id = Number(card.dataset.id);

        if (action.dataset.action === "mark") {
          this.#toggleMark(id);
        } else if (action.dataset.action === "edit") {
          this.editingId = id;
          this.#render();
        } else if (action.dataset.action === "delete") {
          this.#deleteLink(id);
        }
        return;
      }

      // Card body click (navigation) — track usage
      const card = e.target.closest(".ql-card");
      if (card && !action) {
        const id = Number(card.dataset.id);
        QuickLinksStorage.incrementUseCount(id);
        // Update in-memory links so sort reflects immediately
        const link = this.links.find((l) => l.id === id);
        if (link) link.useCount = (link.useCount || 0) + 1;
      }
    });

    // File upload → save to project directory via server
    this.root.addEventListener("change", async (e) => {
      if (e.target.classList.contains("ql-file-input")) {
        const file = e.target.files[0];
        if (!file) return;
        const iconUrlInput = this.root.querySelector(".ql-input-iconurl");
        if (!iconUrlInput) return;

        iconUrlInput.value = "Uploading…";

        const ext = (file.name.split(".").pop() || "png").toLowerCase();
        try {
          const res = await fetch(`/api/upload-icon?ext=${ext}`, {
            method: "POST",
            body: file,
          });
          if (res.ok) {
            const data = await res.json();
            iconUrlInput.value = data.path;
          } else {
            this.#readAsBase64(file, iconUrlInput);
          }
        } catch {
          // Server not available — fallback to base64
          this.#readAsBase64(file, iconUrlInput);
        }
      }
    });

    // Enter key in form inputs submits
    this.root.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches(".ql-input, .ql-input-iconurl")) {
        e.preventDefault();
        this.#saveForm();
      }
    });
  }

  #saveForm() {
    const nameInput = this.root.querySelector(".ql-input-name");
    const urlInput = this.root.querySelector(".ql-input-url");
    const colorInput = this.root.querySelector(".ql-color-custom");
    const iconInput = this.root.querySelector(".ql-input-iconurl");
    const markedInput = this.root.querySelector(".ql-input-marked");

    const name = nameInput ? nameInput.value.trim() : "";
    const url = urlInput ? urlInput.value.trim() : "";
    if (!name || !url) return;

    const data = {
      name,
      url,
      color: colorInput ? colorInput.value : "#0d9488",
      icon: iconInput ? iconInput.value.trim() : "",
      marked: markedInput ? markedInput.checked : false,
    };

    if (this.editingId > 0) {
      this.#updateLink(this.editingId, data);
    } else {
      this.#addLink(data);
    }
  }
}
