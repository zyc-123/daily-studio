/**
 * TodoList — interactive, persisted task list component.
 *
 * Each task:
 *   { id, abstract, description, priority, url, completed, createdAt }
 *
 * Priority values: "high" | "medium" | "low" | "none"
 *
 * Usage:
 *   const todos = new TodoList("todo-root");
 *   todos.init();
 */
class TodoList {
  constructor(rootId) {
    this.root = document.getElementById(rootId);
    this.storageKey = CONFIG.todoStorageKey;
    this.tasks = [];
    this.expandedIds = new Set();    // track which items have detail open
  }

  // ── Public API ────────────────────────────────────────────

  init() {
    this.tasks = Storage.load(this.storageKey, []);
    this.#render();
    this.#bindEvents();
    this.#emitStats();
  }

  getStats() {
    const total = this.tasks.length;
    const done = this.tasks.filter((t) => t.completed).length;
    return { total, done, remaining: total - done };
  }

  // ── Internal helpers ──────────────────────────────────────

  #persist() {
    Storage.save(this.storageKey, this.tasks);
    this.#emitStats();
  }

  #emitStats() {
    this.root.dispatchEvent(
      new CustomEvent("todolist:stats", {
        detail: this.getStats(),
        bubbles: true,
      })
    );
  }

  #nextId() {
    return this.tasks.length > 0
      ? Math.max(...this.tasks.map((t) => t.id)) + 1
      : 1;
  }

  // ── CRUD ─────────────────────────────────────────────────

  /**
   * Add a task.  `fields` may be a plain string (abstract only, no extras)
   * or an object: { abstract, description?, priority?, url? }
   */
  addTask(fields) {
    if (typeof fields === "string") {
      fields = { abstract: fields };
    }

    const abstract = (fields.abstract || "").trim();
    if (!abstract) return;

    if (this.tasks.length >= CONFIG.todoMaxItems) {
      this.#flashMessage("List is full!");
      return;
    }

    this.tasks.push({
      id: this.#nextId(),
      abstract,
      description: (fields.description || "").trim(),
      priority: fields.priority || "none",
      url: (fields.url || "").trim(),
      completed: false,
      createdAt: new Date().toISOString(),
    });

    this.#persist();
    this.#render();
  }

  toggleTask(id) {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    task.completed = !task.completed;
    this.#persist();
    this.#refreshItem(id);
  }

  deleteTask(id) {
    this.expandedIds.delete(id);
    this.tasks = this.tasks.filter((t) => t.id !== id);
    this.#persist();
    this.#render();
  }

  /** Merge `changes` into the task identified by `id`. */
  updateTask(id, changes) {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    Object.assign(task, changes);

    // Trim text fields
    if (changes.abstract !== undefined) task.abstract = task.abstract.trim();
    if (changes.description !== undefined) task.description = task.description.trim();
    if (changes.url !== undefined) task.url = task.url.trim();

    this.#persist();
    this.#refreshItem(id);
  }

  clearCompleted() {
    this.tasks = this.tasks.filter((t) => !t.completed);
    this.#persist();
    this.#render();
  }

  // ── Expand / collapse ─────────────────────────────────────

  #toggleExpand(id) {
    if (this.expandedIds.has(id)) {
      this.expandedIds.delete(id);
    } else {
      this.expandedIds.add(id);
    }
    this.#refreshItem(id);
  }

  // ── Rendering ─────────────────────────────────────────────

  #render() {
    const list = this.root.querySelector(".todo-list");
    if (!list) return;

    if (this.tasks.length === 0) {
      list.innerHTML = this.#emptyHTML();
      return;
    }

    list.innerHTML = this.tasks
      .map((t) => this.#itemHTML(t))
      .join("");

    const last = list.lastElementChild;
    if (last) last.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  #refreshItem(id) {
    const el = this.root.querySelector(`[data-id="${id}"]`);
    if (!el) return;
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    el.outerHTML = this.#itemHTML(task);
  }

  #itemHTML(task) {
    const cls = [
      "todo-item",
      task.completed ? "completed" : "",
      this.expandedIds.has(task.id) ? "expanded" : "",
    ].filter(Boolean).join(" ");

    const hasUrl = !!task.url;
    const hasDesc = !!task.description;
    const expanded = this.expandedIds.has(task.id);

    return `
      <li class="${cls}" data-id="${task.id}" data-priority="${task.priority}">
        <div class="todo-priority-bar" title="Priority: ${task.priority}"></div>

        <button class="todo-check" title="${task.completed ? "Mark incomplete" : "Mark complete"}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>

        <div class="todo-body">
          <span class="todo-abstract" title="Double-click to edit">${this.#escape(task.abstract)}</span>
          ${hasDesc ? `<div class="todo-description">${this.#escape(task.description)}</div>` : ""}
          ${expanded ? this.#detailFormHTML(task) : ""}
        </div>

        <div class="todo-actions">
          ${hasDesc || !task.completed ? `
          <button class="todo-expand-btn" title="${expanded ? "Hide details" : "Show details"}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                 class="todo-chevron ${expanded ? "rotated" : ""}">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>` : ""}

          ${hasUrl ? `
          <a class="todo-link-btn" href="${this.#escapeAttr(task.url)}"
             target="_blank" rel="noopener" title="Open link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>` : ""}

          <button class="todo-delete" title="Delete task">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            </svg>
          </button>
        </div>
      </li>`;
  }

  /** Inline editing form shown when a task is expanded. */
  #detailFormHTML(task) {
    const priorityOpts = ["none", "low", "medium", "high"]
      .map((p) => `<option value="${p}" ${task.priority === p ? "selected" : ""}>${p}</option>`)
      .join("");

    return `
      <div class="todo-detail-form">
        <div class="todo-detail-row">
          <label class="todo-detail-label">Description</label>
          <textarea class="todo-detail-desc"
            data-field="description"
            rows="2"
            placeholder="Add details…">${this.#escape(task.description)}</textarea>
        </div>
        <div class="todo-detail-row todo-detail-inline">
          <label class="todo-detail-label">Priority</label>
          <select class="todo-detail-priority" data-field="priority">
            ${priorityOpts}
          </select>
        </div>
        <div class="todo-detail-row">
          <label class="todo-detail-label">Link</label>
          <input class="todo-detail-url ql-suggest-url" data-field="url"
            type="url" placeholder="https://…"
            value="${this.#escapeAttr(task.url)}" />
        </div>
        <button class="todo-detail-save">Save</button>
      </div>`;
  }

  #emptyHTML() {
    return `
      <li class="todo-empty">
        <div class="todo-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
        </div>
        <p>All clear! Add a task to get started.</p>
      </li>`;
  }

  // ── Utilities ─────────────────────────────────────────────

  #escape(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  #escapeAttr(str) {
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
              .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  #flashMessage(msg) {
    const el = this.root.querySelector(".todo-flash");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("visible");
    setTimeout(() => el.classList.remove("visible"), 2000);
  }

  // ── Event binding ─────────────────────────────────────────

  #bindEvents() {
    const addBtn = this.root.querySelector(".todo-add-btn");
    const abstractInput = this.root.querySelector(".todo-input-abstract");
    const expandInputBtn = this.root.querySelector(".todo-input-expand");
    const advancedRow = this.root.querySelector(".todo-input-advanced");
    const descInput = this.root.querySelector(".todo-input-desc");
    const prioritySelect = this.root.querySelector(".todo-input-priority");
    const urlInput = this.root.querySelector(".todo-input-url");
    const list = this.root.querySelector(".todo-list");
    const clearBtn = this.root.querySelector(".todo-clear-btn");

    // ── Add task ──────────────────────────────────────────

    const gatherAndAdd = () => {
      const abstract = abstractInput.value;
      if (!abstract.trim()) return;

      this.addTask({
        abstract,
        description: descInput ? descInput.value : "",
        priority: prioritySelect ? prioritySelect.value : "none",
        url: urlInput ? urlInput.value : "",
      });

      // Reset form
      abstractInput.value = "";
      if (descInput) descInput.value = "";
      if (prioritySelect) prioritySelect.value = "none";
      if (urlInput) urlInput.value = "";
      if (advancedRow) advancedRow.classList.remove("visible");
      abstractInput.focus();
    };

    addBtn.addEventListener("click", gatherAndAdd);
    abstractInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); gatherAndAdd(); }
    });

    // Toggle advanced input row
    if (expandInputBtn && advancedRow) {
      expandInputBtn.addEventListener("click", () => {
        const open = advancedRow.classList.toggle("visible");
        expandInputBtn.classList.toggle("active", open);
        if (open) descInput && descInput.focus();
      });
    }

    // ── Item interactions (event delegation) ─────────────

    list.addEventListener("click", (e) => {
      const item = e.target.closest(".todo-item");
      if (!item) return;
      const id = Number(item.dataset.id);

      // Checkbox toggle
      if (e.target.closest(".todo-check")) {
        this.toggleTask(id);
        return;
      }

      // Delete
      if (e.target.closest(".todo-delete")) {
        this.deleteTask(id);
        return;
      }

      // Expand / collapse
      if (e.target.closest(".todo-expand-btn")) {
        this.#toggleExpand(id);
        return;
      }

      // Save detail form
      if (e.target.closest(".todo-detail-save")) {
        const form = e.target.closest(".todo-detail-form");
        if (!form) return;
        const desc = form.querySelector("[data-field=description]").value;
        const priority = form.querySelector("[data-field=priority]").value;
        const url = form.querySelector("[data-field=url]").value;
        this.updateTask(id, { description: desc, priority, url });
        return;
      }

      // Link button — let default anchor behavior through
      if (e.target.closest(".todo-link-btn")) {
        return;
      }
    });

    // Double-click abstract to inline-edit
    list.addEventListener("dblclick", (e) => {
      const abstractEl = e.target.closest(".todo-abstract");
      if (!abstractEl) return;
      const item = abstractEl.closest(".todo-item");
      if (!item) return;
      const id = Number(item.dataset.id);
      const task = this.tasks.find((t) => t.id === id);
      if (!task || task.completed) return;

      const span = abstractEl;
      const oldText = task.abstract;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "todo-edit-input";
      input.value = oldText;
      span.replaceWith(input);
      input.focus();
      input.select();

      const commit = () => {
        this.updateTask(id, { abstract: input.value });
      };
      const cancel = () => {
        this.#refreshItem(id);
      };

      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { input.blur(); }
        if (e.key === "Escape") { input.removeEventListener("blur", commit); cancel(); }
      });
    });

    // Clear completed
    if (clearBtn) {
      clearBtn.addEventListener("click", () => this.clearCompleted());
    }
  }
}
