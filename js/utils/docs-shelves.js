/**
 * Docs — the shelf layout.
 *
 * Each shelf owns a folder of its own on the server, so a file belongs
 * to exactly one shelf. Shelves can be added, renamed and removed;
 * files can be added, previewed, edited and deleted.
 *
 * Deleting is a right-click affair: right-click a book to open its
 * menu, or ctrl/shift-click to gather several and delete them together.
 * A plain left-click still opens the preview.
 *
 * Rows scroll sideways under the wheel; at either end the gesture falls
 * through to the page, so you are never trapped in a row.
 */
class DocsShelves {

  static #root = null;
  static #state = { shelves: [] };
  static #scrollMemory = {};
  static #previewToken = 0;
  static #dialog = null;        // at most one modal open at a time
  static #menu = null;          // the open right-click menu, if any
  static #selection = new Map();  // shelfId -> Set of file names
  static #anchor = null;          // { shelfId, name } for shift-ranges

  // ── Boot ──────────────────────────────────────────────────
  static async init(rootId) {
    this.#root = document.getElementById(rootId);
    if (!this.#root) return;

    this.#root.innerHTML = '<p class="shelf-status">Loading…</p>';
    this.#previewEl();
    this.#closeMenu();

    try {
      const response = await fetch("/api/docs");
      if (!response.ok) throw new Error("Docs unavailable");
      const docs = await response.json();
      this.#state.shelves = docs.shelves || [];
    } catch {
      this.#root.innerHTML =
        '<p class="shelf-status">Could not reach the library. ' +
        'Open the app through the local server to manage docs.</p>';
      return;
    }

    // Drop selection entries for shelves or files that are gone.
    const live = new Map();
    for (const shelf of this.#state.shelves) {
      const kept = this.#selection.get(shelf.id);
      if (!kept) continue;
      const names = new Set((shelf.files || []).map((f) => f.name));
      const still = new Set([...kept].filter((n) => names.has(n)));
      if (still.size) live.set(shelf.id, still);
    }
    this.#selection = live;

    this.#render();
  }

  // ── Selection ─────────────────────────────────────────────
  static #selected(shelfId) {
    return this.#selection.get(shelfId) || new Set();
  }

  static #setSelected(shelfId, names) {
    if (names.size) this.#selection.set(shelfId, names);
    else this.#selection.delete(shelfId);
  }

  static #clearSelection() {
    if (!this.#selection.size) return;
    this.#selection.clear();
    this.#anchor = null;
    this.#root.querySelectorAll(".book.is-selected")
      .forEach((b) => b.classList.remove("is-selected"));
  }

  /** Repaint the selected state without rebuilding the shelves. */
  static #paintSelection() {
    for (const shelf of this.#state.shelves) {
      const picked = this.#selected(shelf.id);
      const section = this.#root.querySelector('[data-shelf="' + shelf.id + '"]');
      if (!section) continue;
      section.querySelectorAll(".book").forEach((card) => {
        card.classList.toggle("is-selected", picked.has(card.dataset.name));
      });
      const count = section.querySelector(".shelf-picked");
      if (count) {
        count.textContent = picked.size ? picked.size + " selected" : "";
        count.hidden = picked.size === 0;
      }
    }
  }

  static #clickBook(shelf, item, ev) {
    const picked = new Set(this.#selected(shelf.id));

    if (ev.shiftKey && this.#anchor && this.#anchor.shelfId === shelf.id) {
      const names = (shelf.files || []).map((f) => f.name);
      const from = names.indexOf(this.#anchor.name);
      const to = names.indexOf(item.name);
      if (from !== -1 && to !== -1) {
        for (let i = Math.min(from, to); i <= Math.max(from, to); i += 1) picked.add(names[i]);
        this.#setSelected(shelf.id, picked);
        this.#paintSelection();
        return;
      }
    }

    if (ev.ctrlKey || ev.metaKey) {
      if (picked.has(item.name)) picked.delete(item.name);
      else picked.add(item.name);
      this.#setSelected(shelf.id, picked);
      this.#anchor = { shelfId: shelf.id, name: item.name };
      this.#paintSelection();
      return;
    }

    // A plain click opens the file; it also drops any selection, the way
    // clicking away from a selection does everywhere else.
    this.#clearSelection();
    this.#open(shelf, item);
  }

  // ── Rendering ─────────────────────────────────────────────
  static #render() {
    this.#root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "shelves";

    for (const shelf of this.#state.shelves) wrap.appendChild(this.#shelf(shelf));

    const add = document.createElement("button");
    add.type = "button";
    add.className = "shelf-add";
    add.innerHTML = '<span aria-hidden="true">+</span> Add shelf';
    add.addEventListener("click", () => this.#addShelf());
    wrap.appendChild(add);

    this.#root.appendChild(wrap);
  }

  static #shelf(shelf) {
    const books = shelf.files || [];
    const section = document.createElement("section");
    section.className = "shelf";
    section.dataset.shelf = shelf.id;

    // ── head ──
    const head = document.createElement("header");
    head.className = "shelf-head";

    const name = document.createElement("h2");
    name.className = "shelf-name";
    name.textContent = shelf.name;
    name.tabIndex = 0;
    name.title = "Click to rename";
    name.setAttribute("role", "button");
    name.addEventListener("click", () => this.#renameShelf(shelf, name));
    name.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); this.#renameShelf(shelf, name); }
    });

    const count = document.createElement("span");
    count.className = "shelf-count";
    count.textContent = books.length === 1 ? "1 item" : books.length + " items";

    const picked = document.createElement("span");
    picked.className = "shelf-picked";
    picked.hidden = true;

    head.append(name, count, picked);
    head.appendChild(this.#shelfTools(shelf, books));

    if (shelf.note) {
      const note = document.createElement("p");
      note.className = "shelf-note";
      note.textContent = shelf.note;
      head.appendChild(note);
    }

    // ── the row ──
    const row = document.createElement("div");
    row.className = "shelf-row";
    row.tabIndex = 0;
    row.setAttribute("role", "list");
    row.setAttribute("aria-label", shelf.name);

    if (!books.length) {
      const empty = document.createElement("p");
      empty.className = "shelf-empty";
      empty.textContent = "Nothing here yet — use Upload or New text.";
      row.appendChild(empty);
    } else {
      books.forEach((item, i) => row.appendChild(this.#book(shelf, item, i)));
    }

    this.#bindWheel(row, shelf);

    const plank = document.createElement("div");
    plank.className = "shelf-plank";
    plank.setAttribute("aria-hidden", "true");

    section.append(head, row, plank);
    return section;
  }

  static #shelfTools(shelf, books) {
    const tools = document.createElement("span");
    tools.className = "shelf-tools";

    const upload = document.createElement("button");
    upload.type = "button";
    upload.className = "shelf-btn";
    upload.textContent = "Upload";
    upload.addEventListener("click", () => this.#pickFile(shelf));

    const create = document.createElement("button");
    create.type = "button";
    create.className = "shelf-btn";
    create.textContent = "New text";
    create.addEventListener("click", () => this.#newText(shelf));

    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "shelf-btn shelf-btn--icon";
    drop.title = "Remove this shelf";
    drop.setAttribute("aria-label", "Remove shelf " + shelf.name);
    drop.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                     'stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/>' +
                     '<line x1="18" y1="6" x2="6" y2="18"/></svg>';
    drop.addEventListener("click", () => this.#removeShelf(shelf, books.length));

    tools.append(upload, create, drop);
    return tools;
  }

  static #book(shelf, item, index) {
    const card = document.createElement("a");
    card.className = "book book--c" + ((index % 5) + 1);
    card.href = "#";
    card.dataset.name = item.name;
    card.setAttribute("role", "listitem");
    if (this.#selected(shelf.id).has(item.name)) card.classList.add("is-selected");

    card.addEventListener("click", (ev) => {
      ev.preventDefault();
      this.#clickBook(shelf, item, ev);
    });

    card.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      const picked = new Set(this.#selected(shelf.id));
      // Right-clicking something outside the selection acts on that alone.
      if (!picked.has(item.name)) {
        this.#setSelected(shelf.id, new Set([item.name]));
        this.#anchor = { shelfId: shelf.id, name: item.name };
        this.#paintSelection();
      }
      this.#openMenu(shelf, ev.clientX, ev.clientY);
    });

    const spine = document.createElement("span");
    spine.className = "book-spine";
    spine.setAttribute("aria-hidden", "true");

    const body = document.createElement("span");
    body.className = "book-body";

    const title = document.createElement("span");
    title.className = "book-title";
    title.textContent = item.name;

    const meta = document.createElement("span");
    meta.className = "book-meta";
    meta.textContent = this.#meta(item);

    body.append(title, meta);
    card.append(spine, body);
    return card;
  }

  static #meta(item) {
    const parts = [];
    if (item.ext) parts.push(item.ext.toUpperCase());
    if (typeof item.size === "number") parts.push(this.#size(item.size));
    return parts.join(" · ");
  }

  static #size(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  // ── The right-click menu ──────────────────────────────────
  static #closeMenu() {
    if (this.#menu) { this.#menu.remove(); this.#menu = null; }
  }

  static #openMenu(shelf, x, y) {
    this.#closeMenu();
    const picked = this.#selected(shelf.id);
    const count = picked.size || 1;

    const menu = document.createElement("div");
    menu.className = "book-menu";
    menu.setAttribute("role", "menu");

    const openItem = document.createElement("button");
    openItem.type = "button";
    openItem.className = "book-menu-item";
    openItem.setAttribute("role", "menuitem");
    openItem.textContent = "Open";
    openItem.disabled = count > 1;
    openItem.addEventListener("click", () => {
      const item = (shelf.files || []).find((f) => picked.has(f.name));
      this.#closeMenu();
      if (item) this.#open(shelf, item);
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "book-menu-item book-menu-item--danger";
    del.setAttribute("role", "menuitem");
    del.textContent = count > 1 ? "Delete " + count + " files" : "Delete";
    del.addEventListener("click", () => {
      this.#closeMenu();
      this.#deleteSelected(shelf, [...picked]);
    });

    menu.append(openItem, del);
    document.body.appendChild(menu);

    // Keep it on screen, then focus the first entry so the keyboard can
    // walk it — Enter then does what the highlighted item says.
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + "px";
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + "px";
    menu.querySelector(".book-menu-item").focus();

    this.#menu = menu;
    setTimeout(() => {
      const dismiss = (ev) => {
        if (menu.contains(ev.target)) return;
        this.#closeMenu();
        document.removeEventListener("mousedown", dismiss, true);
        document.removeEventListener("keydown", onKey, true);
      };
      const onKey = (ev) => {
        if (ev.key !== "Escape") return;
        this.#closeMenu();
        document.removeEventListener("mousedown", dismiss, true);
        document.removeEventListener("keydown", onKey, true);
      };
      document.addEventListener("mousedown", dismiss, true);
      document.addEventListener("keydown", onKey, true);
    }, 0);
  }

  // ── Files: add, delete, edit ──────────────────────────────
  static #pickFile(shelf) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,.md,.pdf,text/plain,application/pdf";
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const res = await fetch("/api/docs/upload", {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream",
                     "X-Doc-Name": encodeURIComponent(file.name),
                     "X-Doc-Shelf": shelf.id },
          body: file,
        });
        const out = await res.json();
        if (!out.ok) throw new Error(out.error || "Upload failed");
        await this.init(this.#root.id);
      } catch (error) {
        this.#toast(error.message);
      }
    });
    input.click();
  }

  static #newText(shelf) {
    this.#prompt({
      title: "New text file",
      nameLabel: "File name",
      namePlaceholder: "notes",
      withBody: true,
      onSave: async (name, content) => {
        const res = await fetch("/api/docs/new", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shelf: shelf.id, name, content }),
        });
        const out = await res.json();
        if (!out.ok) throw new Error(out.error || "Could not create the file");
        await this.init(this.#root.id);
      },
    });
  }

  static #deleteSelected(shelf, names) {
    if (!names.length) return;
    this.#prompt({
      title: names.length > 1 ? "Delete " + names.length + " files" : "Delete file",
      message: names.length > 1
        ? names.join("\n")
        : '"' + names[0] + '" will be removed from ' + shelf.name + ".",
      confirmLabel: "Delete",
      danger: true,
      onSave: async () => {
        const res = await fetch("/api/docs/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shelf: shelf.id, names }),
        });
        const out = await res.json();
        if (!out.ok) throw new Error(out.error || "Could not delete");
        this.#selection.delete(shelf.id);
        this.#anchor = null;
        await this.init(this.#root.id);
      },
    });
  }

  // ── Shelves: add, rename, remove ──────────────────────────
  static #addShelf() {
    this.#prompt({
      title: "New shelf",
      nameLabel: "Shelf name",
      namePlaceholder: "Papers",
      onSave: async (name) => {
        const res = await fetch("/api/docs/shelves", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "add", name }),
        });
        const out = await res.json();
        if (!out.ok) throw new Error(out.error || "Could not add the shelf");
        await this.init(this.#root.id);
      },
    });
  }

  static #renameShelf(shelf, label) {
    const input = document.createElement("input");
    input.className = "shelf-name-input";
    input.value = shelf.name;
    input.maxLength = 60;
    label.replaceWith(input);
    input.focus();
    input.select();

    let settled = false;
    const commit = async (save) => {
      if (settled) return;
      settled = true;
      const next = input.value.trim();
      input.replaceWith(label);
      if (!save || !next || next === shelf.name) return;
      try {
        const res = await fetch("/api/docs/shelves", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rename", id: shelf.id, name: next }),
        });
        const out = await res.json();
        if (!out.ok) throw new Error(out.error || "Rename failed");
        shelf.name = next;
        label.textContent = next;
      } catch (error) {
        this.#toast(error.message);
      }
    };

    input.addEventListener("blur", () => commit(true));
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); commit(true); }
      if (ev.key === "Escape") { ev.preventDefault(); commit(false); }
    });
  }

  static #removeShelf(shelf, fileCount) {
    this.#prompt({
      title: "Remove shelf",
      message: fileCount
        ? '"' + shelf.name + '" and its ' + fileCount +
          (fileCount === 1 ? " file" : " files") + " will be removed. This cannot be undone."
        : '"' + shelf.name + '" will be removed.',
      confirmLabel: "Remove",
      danger: true,
      onSave: async () => {
        const res = await fetch("/api/docs/shelves", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remove", id: shelf.id }),
        });
        const out = await res.json();
        if (!out.ok) throw new Error(out.error || "Could not remove the shelf");
        this.#selection.delete(shelf.id);
        await this.init(this.#root.id);
      },
    });
  }

  // ── Preview ───────────────────────────────────────────────
  static #previewEl() {
    let el = document.getElementById("docs-preview");
    if (el) return el;

    el = document.createElement("div");
    el.id = "docs-preview";
    el.className = "docs-preview";
    el.hidden = true;
    el.innerHTML =
      '<div class="docs-preview-backdrop" data-close></div>' +
      '<div class="docs-preview-panel" role="dialog" aria-modal="true" ' +
           'aria-labelledby="docs-preview-title">' +
        '<header class="docs-preview-head">' +
          '<span class="docs-preview-title" id="docs-preview-title"></span>' +
          '<span class="docs-preview-kind" id="docs-preview-kind"></span>' +
          '<span class="docs-preview-actions" id="docs-preview-actions"></span>' +
          '<button class="docs-preview-close" type="button" data-close aria-label="Close">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
                 'stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/>' +
                 '<line x1="18" y1="6" x2="6" y2="18"/></svg>' +
          '</button>' +
        '</header>' +
        '<div class="docs-preview-body" id="docs-preview-body"></div>' +
      '</div>';
    el.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-close]")) this.closePreview();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !el.hidden) this.closePreview();
    });
    document.body.appendChild(el);
    return el;
  }

  static async #open(shelf, item) {
    const el = this.#previewEl();
    const body = el.querySelector("#docs-preview-body");

    // Every open takes a token. Loading is async, and a slow fetch must
    // not paint over a newer preview or an editor the user already
    // opened — so each write checks it is still the current one.
    const token = ++this.#previewToken;
    const stillCurrent = () => token === this.#previewToken;

    el.querySelector("#docs-preview-title").textContent = item.name;
    el.querySelector("#docs-preview-kind").textContent =
      (item.ext || "").toUpperCase() + (shelf.readonly ? " · preview only" : "");
    el.querySelector("#docs-preview-actions").innerHTML = "";

    body.classList.remove("is-editing");
    body.innerHTML = '<p class="shelf-status">Loading…</p>';
    el.hidden = false;

    const ext = (item.ext || "").toLowerCase();
    const isText = ext === "txt" || ext === "md";

    let source = null;
    if (isText) {
      try {
        source = await fetch(this.#urlFor(shelf, item)).then((r) => r.text());
      } catch {
        if (stillCurrent()) body.innerHTML = '<p class="shelf-status">Could not read this file.</p>';
        return;
      }
    }
    if (!stillCurrent()) return;

    if (isText) {
      this.#paintText(body, source);
      if (!shelf.readonly) this.#addEdit(shelf, body, item, source);
      return;
    }

    if (ext === "pdf") {
      const frame = document.createElement("iframe");
      frame.className = "docs-preview-pdf";
      frame.src = this.#urlFor(shelf, item);
      frame.title = item.name;
      body.innerHTML = "";
      body.appendChild(frame);
      return;
    }

    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
      const img = document.createElement("img");
      img.className = "docs-preview-image";
      img.src = this.#urlFor(shelf, item);
      img.alt = item.name;
      body.innerHTML = "";
      body.appendChild(img);
      return;
    }

    body.innerHTML = '<p class="shelf-status">No preview for this file type.</p>';
  }

  /** Text goes through the shared Markdown renderer, exactly as the
   *  work log's preview does. */
  static #paintText(body, source) {
    body.classList.remove("is-editing");
    body.innerHTML = "";
    const article = document.createElement("article");
    article.className = "markdown-body";
    article.innerHTML = Markdown.toHtml(source);
    body.appendChild(article);
  }

  static #addEdit(shelf, body, item, source) {
    const actions = document.getElementById("docs-preview-actions");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "docs-preview-edit";
    btn.textContent = "Edit";

    btn.addEventListener("click", () => {
      // Pressing Edit again while already editing would mount a second
      // editor over the first and lose whatever is typed.
      if (body.classList.contains("is-editing")) return;
      body.classList.add("is-editing");
      body.innerHTML = "";

      let current = source;
      DocEditor.open({
        container: body,
        text: source,
        variant: "file",
        onDirty: (text) => { current = text; },
        onSave: async () => {
          const res = await fetch("/api/docs/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shelf: shelf.id, name: item.name, content: current }),
          });
          const out = await res.json();
          if (!out.ok) throw new Error(out.error || "Could not save");
          source = current;
          body.classList.remove("is-editing");
          this.#paintText(body, source);
          this.#toast("Saved " + item.name);
        },
        onCancel: () => {
          body.classList.remove("is-editing");
          this.#paintText(body, source);
        },
        // The editor knows nothing about shelves or endpoints; it asks
        // and gets Markdown back.
        onPick: (kind) => (kind === "image" ? this.#uploadImage(shelf) : null),
        onError: (message) => this.#toast(message),
      });
    });

    actions.appendChild(btn);
  }

  /** Pick an image, upload it to this shelf, return the Markdown for it. */
  static #uploadImage(shelf) {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.className = "doc-image-input";
      input.accept = "image/png,image/jpeg,image/gif,image/webp";

      const finish = (fn, value) => { input.remove(); fn(value); };

      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        if (!file) { finish(resolve, null); return; }
        try {
          const res = await fetch("/api/docs/image", {
            method: "POST",
            headers: { "Content-Type": file.type || "application/octet-stream",
                       "X-Doc-Shelf": shelf.id },
            body: file,
          });
          const out = await res.json();
          if (!out.ok) throw new Error(out.error || "Upload failed");
          finish(resolve, "![](" + out.url + "){width=100%}");
        } catch (error) {
          finish(reject, error);
        }
      });

      // A cancelled picker fires no change event, so the stale input is
      // swept up by the next insert instead.
      document.body.appendChild(input);
      input.click();
    });
  }

  static #urlFor(shelf, item) {
    return "/api/docs/raw?shelf=" + encodeURIComponent(shelf.id) +
           "&name=" + encodeURIComponent(item.name);
  }

  static closePreview() {
    this.#previewToken++;                  // strand any in-flight load
    const el = document.getElementById("docs-preview");
    if (!el) return;
    el.hidden = true;
    el.querySelector("#docs-preview-body").innerHTML = "";   // stop PDFs loading
  }

  // ── Small dialogs ─────────────────────────────────────────
  static #prompt(opts) {
    const wrap = document.createElement("div");
    wrap.className = "docs-dialog";
    wrap.innerHTML =
      '<div class="docs-preview-backdrop" data-cancel></div>' +
      '<form class="docs-dialog-panel">' +
        '<h3 class="docs-dialog-title"></h3>' +
        '<p class="docs-dialog-message"></p>' +
        '<label class="docs-dialog-field docs-dialog-nameline" hidden>' +
          '<span class="docs-dialog-label"></span>' +
          '<input class="docs-dialog-input" type="text" maxlength="120" />' +
        '</label>' +
        '<label class="docs-dialog-field docs-dialog-bodyline" hidden>' +
          '<span class="docs-dialog-label">Content</span>' +
          '<textarea class="docs-dialog-text" rows="10"></textarea>' +
        '</label>' +
        '<div class="docs-dialog-actions">' +
          '<button type="button" class="docs-dialog-btn" data-cancel>Cancel</button>' +
          '<button type="submit" class="docs-dialog-btn docs-dialog-btn--primary"></button>' +
        '</div>' +
      '</form>';

    wrap.querySelector(".docs-dialog-title").textContent = opts.title;
    const message = wrap.querySelector(".docs-dialog-message");
    if (opts.message) message.textContent = opts.message; else message.remove();

    const nameField = wrap.querySelector(".docs-dialog-nameline");
    const nameInput = wrap.querySelector(".docs-dialog-input");
    if (opts.nameLabel) {
      nameField.hidden = false;
      nameField.querySelector(".docs-dialog-label").textContent = opts.nameLabel;
      nameInput.placeholder = opts.namePlaceholder || "";
    } else {
      nameField.remove();
    }

    const bodyField = wrap.querySelector(".docs-dialog-bodyline");
    const bodyText = wrap.querySelector(".docs-dialog-text");
    if (opts.withBody) bodyField.hidden = false;
    else bodyField.remove();

    const submit = wrap.querySelector('button[type="submit"]');
    submit.textContent = opts.confirmLabel || "Save";
    if (opts.danger) submit.classList.add("docs-dialog-btn--danger");

    const close = () => {
      if (this.#dialog === wrap) this.#dialog = null;
      wrap.remove();
    };

    wrap.addEventListener("click", (ev) => { if (ev.target.closest("[data-cancel]")) close(); });
    document.addEventListener("keydown", function onKey(ev) {
      if (ev.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
    });

    wrap.querySelector("form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const name = nameInput ? nameInput.value.trim() : "";
      if (opts.nameLabel && !name) { nameInput.focus(); return; }
      submit.disabled = true;
      try {
        await opts.onSave(name, bodyText ? bodyText.value : "");
        close();
      } catch (error) {
        submit.disabled = false;
        this.#toast(error.message);
      }
    });

    // Focus has to land inside the dialog. Without this it stays on the
    // control that opened it, and Enter simply activates that control
    // again — stacking a second identical dialog on top of the first.
    if (this.#dialog) this.#dialog.remove();
    this.#dialog = wrap;

    document.body.appendChild(wrap);
    const focusTarget = (opts.nameLabel && nameInput)
      ? nameInput
      : (opts.withBody && bodyText)
        ? bodyText
        : submit;
    focusTarget.focus();
  }

  static #toast(text) {
    const el = document.createElement("div");
    el.className = "docs-toast";
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // ── Row scrolling ─────────────────────────────────────────
  /**
   * Wheel scrolls the row sideways. At either end the handler steps
   * aside so the wheel scrolls the page — without that, a row already
   * at its end would swallow the gesture and feel stuck.
   */
  static #bindWheel(row, shelf) {
    const key = shelf.id;
    const saved = this.#scrollMemory[key];
    if (saved) row.scrollLeft = saved;

    row.addEventListener("scroll", () => {
      this.#scrollMemory[key] = Math.round(row.scrollLeft);
    }, { passive: true });

    row.addEventListener("wheel", (ev) => {
      const max = row.scrollWidth - row.clientWidth;
      if (max <= 1) return;                       // nothing to scroll

      const step = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
      if (step === 0) return;

      const atStart = row.scrollLeft <= 0 && step < 0;
      const atEnd = row.scrollLeft >= max - 1 && step > 0;
      if (atStart || atEnd) return;               // hand the gesture to the page

      ev.preventDefault();
      row.scrollLeft += step;
    }, { passive: false });

    row.addEventListener("keydown", (ev) => {
      const nudge = ev.key === "ArrowRight" ? 140 : ev.key === "ArrowLeft" ? -140 : 0;
      if (!nudge) return;
      ev.preventDefault();
      row.scrollBy({ left: nudge, behavior: "smooth" });
    });
  }
}
