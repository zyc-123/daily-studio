/**
 * Calendar — monthly grid (right panel) + day editor (main content).
 *
 * Each day cell shows the date number and mini priority dots.
 * Click a day to open the day editor in the main content area
 * with full todo CRUD for that date.
 *
 * Usage:
 *   const cal = new Calendar("calendar-panel", "day-editor-section");
 *   cal.init();
 */
class Calendar {
  /**
   * @param {string} gridRootId   — container for the month grid + nav
   * @param {string} editorRootId — container for the day editor
   */
  constructor(gridRootId, editorRootId) {
    this.gridRoot = document.getElementById(gridRootId);
    this.editorRoot = document.getElementById(editorRootId);
    this.now = new Date();
    this.viewYear = this.now.getFullYear();
    this.viewMonth = this.now.getMonth() + 1;       // 1-indexed
    this.selectedDate = null;                        // "YYYY-MM-DD"
    this.tasks = {};                                 // { "YYYY-MM-DD": [task, ...] }
    this.expandedIds = new Set();
  }

  // ── Public ────────────────────────────────────────────────

  init() {
    this.tasks = CalendarStorage.loadAll();
    // Always start with today selected
    this.selectedDate = this.#dateStr(this.now);
    this.#renderAll();
    this.#bindEvents();
  }

  getTodayStats() {
    const today = this.#dateStr(this.now);
    return CalendarStorage.getStats(today);
  }

  /** Refresh the grid and day editor (call after external changes). */
  refresh() {
    this.#refreshTasks();
    this.#renderGrid();
    this.#renderDayEditor();
    this.#emitStats();
  }

  // ── Navigation ────────────────────────────────────────────

  #goToPrevMonth() {
    if (this.viewMonth === 1) { this.viewYear--; this.viewMonth = 12; }
    else { this.viewMonth--; }
    this.#renderAll();
  }

  #goToNextMonth() {
    if (this.viewMonth === 12) { this.viewYear++; this.viewMonth = 1; }
    else { this.viewMonth++; }
    this.#renderAll();
  }

  #goToToday() {
    this.viewYear = this.now.getFullYear();
    this.viewMonth = this.now.getMonth() + 1;
    this.selectedDate = this.#dateStr(this.now);
    this.#renderAll();
  }

  // ── Day selection ─────────────────────────────────────────

  #selectDate(dateStr) {
    this.selectedDate = dateStr;
    this.expandedIds.clear();
    this.#renderAll();
    this.#emitStats();
  }

  // ── Helpers ───────────────────────────────────────────────

  #dateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  #daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  #dayOfWeek(year, month, day) {
    return new Date(year, month - 1, day).getDay();
  }

  #monthName(year, month) {
    return new Date(year, month - 1, 1).toLocaleDateString("en-US", {
      month: "long", year: "numeric",
    });
  }

  #formatDayTitle(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
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

  // ── Rendering (top-level) ─────────────────────────────────

  #renderAll() {
    this.#refreshTasks();
    const label = this.gridRoot.querySelector(".cal-month-label");
    if (label) label.textContent = this.#monthName(this.viewYear, this.viewMonth);
    this.#renderGrid();
    this.#renderDayEditor();
  }

  #refreshTasks() {
    this.tasks = CalendarStorage.loadAll();
  }

  // ── Grid rendering (in gridRoot / right panel) ────────────

  #renderGrid() {
    const grid = this.gridRoot.querySelector(".cal-grid");
    if (!grid) return;

    const daysInMonth = this.#daysInMonth(this.viewYear, this.viewMonth);
    const startDow = this.#dayOfWeek(this.viewYear, this.viewMonth, 1);
    const todayStr = this.#dateStr(this.now);
    const offset = (startDow - CONFIG.weekStart + 7) % 7;
    const totalCells = offset + daysInMonth;
    const rows = Math.ceil(totalCells / 7);

    let html = "";
    let cellCount = 0;

    for (let r = 0; r < rows; r++) {
      html += '<div class="cal-row">';
      for (let c = 0; c < 7; c++) {
        const dayNum = cellCount - offset + 1;
        const inMonth = dayNum >= 1 && dayNum <= daysInMonth;

        if (inMonth) {
          const dateStr = `${this.viewYear}-${String(this.viewMonth).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
          const dayTasks = this.tasks[dateStr] || [];
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === this.selectedDate;
          html += this.#cellHTML(dateStr, dayNum, dayTasks, isToday, isSelected);
        } else {
          html += '<div class="cal-cell cal-cell-out"></div>';
        }
        cellCount++;
      }
      html += "</div>";
    }

    grid.innerHTML = html;
  }

  #cellHTML(dateStr, dayNum, dayTasks, isToday, isSelected) {
    const cls = [
      "cal-cell",
      isToday ? "cal-cell-today" : "",
      isSelected ? "cal-cell-selected" : "",
    ].filter(Boolean).join(" ");

    let dotsHTML = "";
    const maxDots = CONFIG.calCellMaxDots;
    const incomplete = dayTasks.filter((t) => !t.completed);
    const total = dayTasks.length;

    if (total > 0) {
      const show = incomplete.slice(0, maxDots);
      dotsHTML = show.map((t) =>
        `<span class="cal-dot cal-dot-${t.priority || "none"}" title="${this.#escape(t.abstract)}"></span>`
      ).join("");

      const extra = Math.max(0, total - maxDots);
      if (extra > 0) {
        dotsHTML += `<span class="cal-dot-extra">+${extra}</span>`;
      }
    }

    return `
      <div class="${cls}" data-date="${dateStr}">
        <span class="cal-day-num">${dayNum}</span>
        <div class="cal-dots">${dotsHTML}</div>
      </div>`;
  }

  // ── Day editor rendering (in editorRoot / main content) ───

  #renderDayEditor() {
    if (!this.editorRoot) return;

    if (!this.selectedDate) {
      this.editorRoot.innerHTML = `
        <div class="day-editor-placeholder">
          <div class="todo-empty">
            <div class="todo-empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <p>Select a day in the calendar to view or edit its tasks.</p>
          </div>
        </div>`;
      return;
    }

    const title = this.#formatDayTitle(this.selectedDate);
    const dayTasks = this.tasks[this.selectedDate] || [];

    const listHTML = dayTasks.length === 0
      ? `<li class="todo-empty">
           <div class="todo-empty-icon">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
               <path d="M9 11l3 3L22 4" />
               <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
             </svg>
           </div>
           <p>No tasks for this day. Add one below.</p>
         </li>`
      : dayTasks.map((t) => this.#dayItemHTML(t)).join("");

    this.editorRoot.innerHTML = `
      <div class="cal-day-editor">
        <div class="cal-day-editor-header">
          <h3 class="cal-day-title">${title}</h3>
        </div>

        <div class="todo-input-card">
          <div class="todo-input-row">
            <input type="text"
              class="todo-input-abstract cal-day-input-abstract"
              placeholder="What needs to be done?"
              autocomplete="off" />
            <button class="todo-input-expand cal-day-input-expand" title="Add details">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                   class="todo-input-chevron">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <button class="todo-add-btn cal-day-add-btn" title="Add task">+</button>
          </div>

          <div class="todo-input-advanced cal-day-input-advanced">
            <div class="todo-input-advanced-grid">
              <div class="todo-input-field">
                <label class="todo-input-label">Description</label>
                <textarea class="todo-input-desc cal-day-input-desc"
                  rows="2" placeholder="Add details…"></textarea>
              </div>
              <div class="todo-input-field">
                <label class="todo-input-label">Priority</label>
                <select class="todo-input-priority cal-day-input-priority">
                  <option value="none">None</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div class="todo-input-field">
                <label class="todo-input-label">Link</label>
                <input type="url" class="todo-input-url cal-day-input-url ql-suggest-url"
                  placeholder="https://…" />
              </div>
            </div>
          </div>
        </div>

        <ul class="todo-list cal-day-list">${listHTML}</ul>
      </div>`;
  }

  #dayItemHTML(task) {
    const cls = [
      "todo-item",
      task.completed ? "completed" : "",
      this.expandedIds.has(task.id) ? "expanded" : "",
    ].filter(Boolean).join(" ");

    const hasDesc = !!task.description;
    const hasUrl = !!task.url;
    const expanded = this.expandedIds.has(task.id);

    return `
      <li class="${cls}" data-id="${task.id}" data-priority="${task.priority || "none"}">
        <div class="todo-priority-bar" title="Priority: ${task.priority || "none"}"></div>

        <button class="todo-check" title="${task.completed ? "Mark incomplete" : "Mark complete"}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>

        <div class="todo-body">
          <span class="todo-abstract" title="Double-click to edit">${this.#escape(task.abstract)}</span>
          ${hasDesc ? `<div class="todo-description">${this.#escape(task.description)}</div>` : ""}
          ${expanded ? this.#dayDetailFormHTML(task) : ""}
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

          <button class="todo-reassign" title="Move to another date">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <polyline points="8 14 12 18 16 14" /><line x1="12" y1="18" x2="12" y2="10" />
            </svg>
          </button>
        </div>
      </li>`;
  }

  #dayDetailFormHTML(task) {
    const opts = ["none", "low", "medium", "high"]
      .map((p) => `<option value="${p}" ${(task.priority || "none") === p ? "selected" : ""}>${p}</option>`)
      .join("");

    return `
      <div class="todo-detail-form">
        <div class="todo-detail-row">
          <label class="todo-detail-label">Description</label>
          <textarea class="todo-detail-desc" data-field="description"
            rows="2" placeholder="Add details…">${this.#escape(task.description || "")}</textarea>
        </div>
        <div class="todo-detail-row todo-detail-inline">
          <label class="todo-detail-label">Priority</label>
          <select class="todo-detail-priority" data-field="priority">${opts}</select>
        </div>
        <div class="todo-detail-row">
          <label class="todo-detail-label">Link</label>
          <input class="todo-detail-url ql-suggest-url" data-field="url"
            type="url" placeholder="https://…"
            value="${this.#escapeAttr(task.url || "")}" />
        </div>
        <button class="todo-detail-save">Save</button>
      </div>`;
  }

  // ── Task operations ───────────────────────────────────────

  #addDayTask(fields) {
    if (!this.selectedDate) return;
    const abstract = (fields.abstract || "").trim();
    if (!abstract) return;

    CalendarStorage.addTask(this.selectedDate, {
      abstract,
      description: (fields.description || "").trim(),
      priority: fields.priority || "none",
      url: (fields.url || "").trim(),
      completed: false,
    });

    this.#refreshTasks();
    this.#renderGrid();
    this.#renderDayEditor();
    this.#emitStats();
  }

  #toggleDayTask(taskId) {
    if (!this.selectedDate) return;
    CalendarStorage.toggleTask(this.selectedDate, taskId);
    this.#refreshTasks();
    this.#renderGrid();
    this.#renderDayEditor();
    this.#emitStats();
  }

  #deleteDayTask(taskId) {
    if (!this.selectedDate) return;
    const task = (this.tasks[this.selectedDate] || []).find((item) => item.id === taskId);
    this.expandedIds.delete(taskId);
    CalendarStorage.deleteTask(this.selectedDate, taskId);
    if (task?.longtermId) this.#clearLongTermScheduleIfCurrent(task.longtermId, this.selectedDate);
    this.#refreshTasks();
    this.#renderGrid();
    this.#renderDayEditor();
    this.#emitStats();
  }

  #reassignDayTask(taskId) {
    if (!this.selectedDate) return;
    const tasks = this.tasks[this.selectedDate] || [];
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const today = this.#dateStr(this.now);
    const newDate = prompt(
      `Move "${task.abstract}" to which date? (YYYY-MM-DD)`,
      this.selectedDate
    );
    if (!newDate || !newDate.trim()) return;
    const targetDate = newDate.trim();

    // Remove from current date
    CalendarStorage.deleteTask(this.selectedDate, taskId);
    this.expandedIds.delete(taskId);

    // Add to target date (copy fields, new id)
    const reassignedTask = CalendarStorage.addTask(targetDate, {
      abstract: task.abstract,
      description: task.description || "",
      priority: task.priority || "none",
      url: task.url || "",
      completed: task.completed || false,
    }, task.longtermId);

    if (reassignedTask.longtermId) this.#syncLongTermTask(reassignedTask, {}, targetDate);

    this.#refreshTasks();
    this.#renderGrid();
    this.#renderDayEditor();
    this.#emitStats();
    document.dispatchEvent(new CustomEvent("longterm:changed", { bubbles: true }));
  }

  #updateDayTask(taskId, changes) {
    if (!this.selectedDate) return;
    CalendarStorage.updateTask(this.selectedDate, taskId, changes);
    const task = CalendarStorage.getTasks(this.selectedDate).find((item) => item.id === taskId);
    if (task?.longtermId) this.#syncLongTermTask(task, changes);
    this.#refreshTasks();
    this.#renderGrid();
    this.#renderDayEditor();
    this.#emitStats();
  }

  #syncLongTermTask(task, changes, scheduledDate) {
    const tasks = LongTermStorage.loadAll();
    const node = LongTermStorage.findNode(tasks, task.longtermId);
    if (!node) return false;
    if ("abstract" in changes) {
      const segments = String(changes.abstract).split(" / ").map((segment) => segment.trim()).filter(Boolean);
      node.abstract = segments.at(-1) || node.abstract;
    }
    if ("description" in changes) node.description = changes.description || "";
    if ("priority" in changes) node.priority = changes.priority || "none";
    if (scheduledDate) node.scheduledDate = scheduledDate;
    LongTermStorage.saveAll(tasks);
    CalendarStorage.updateTasksByLongTermId(task.longtermId, {
      abstract: LongTermStorage.getNodePath(tasks, task.longtermId),
      description: node.description || "",
      priority: node.priority || "none",
    });
    document.dispatchEvent(new CustomEvent("longterm:changed", { bubbles: true }));
    return true;
  }

  #clearLongTermScheduleIfCurrent(longtermId, date) {
    const tasks = LongTermStorage.loadAll();
    const node = LongTermStorage.findNode(tasks, longtermId);
    if (!node || node.scheduledDate !== date) return;
    node.scheduledDate = null;
    LongTermStorage.saveAll(tasks);
    document.dispatchEvent(new CustomEvent("longterm:changed", { bubbles: true }));
  }

  #toggleExpand(taskId) {
    if (this.expandedIds.has(taskId)) {
      this.expandedIds.delete(taskId);
    } else {
      this.expandedIds.add(taskId);
    }
    this.#renderDayEditor();
  }

  #emitStats() {
    const dateStr = this.selectedDate || this.#dateStr(this.now);
    document.dispatchEvent(
      new CustomEvent("todolist:stats", { detail: CalendarStorage.getStats(dateStr), bubbles: true })
    );
  }

  // ── Event binding ─────────────────────────────────────────

  #bindEvents() {
    // ── Navigation (in gridRoot) ──────────────────────────
    const prevBtn = this.gridRoot.querySelector(".cal-prev");
    const nextBtn = this.gridRoot.querySelector(".cal-next");
    const todayBtn = this.gridRoot.querySelector(".cal-today-bottom");
    const grid = this.gridRoot.querySelector(".cal-grid");

    prevBtn.addEventListener("click", () => this.#goToPrevMonth());
    nextBtn.addEventListener("click", () => this.#goToNextMonth());
    if (todayBtn) todayBtn.addEventListener("click", () => this.#goToToday());

    // Day cell clicks (gridRoot)
    grid.addEventListener("click", (e) => {
      const cell = e.target.closest(".cal-cell");
      if (!cell) return;
      const dateStr = cell.dataset.date;
      if (!dateStr) return;
      this.#selectDate(dateStr);
    });

    // ── Day editor (in editorRoot, via event delegation on document) ─
    // We use document-level delegation because the editor DOM is
    // rebuilt on every render, so direct bindings would be lost.
    document.addEventListener("click", (e) => {
      // Only handle if the click is inside the editor root
      if (!this.editorRoot || !this.editorRoot.contains(e.target)) return;

      // ── Form-level buttons (outside .todo-item) ──────────
      if (e.target.closest(".cal-day-add-btn")) {
        this.#gatherAndAdd();
        return;
      }
      if (e.target.closest(".cal-day-input-expand")) {
        const btn = e.target.closest(".cal-day-input-expand");
        const row = this.editorRoot.querySelector(".cal-day-input-advanced");
        if (row) {
          const open = row.classList.toggle("visible");
          btn.classList.toggle("active", open);
          if (open) {
            const desc = this.editorRoot.querySelector(".cal-day-input-desc");
            if (desc) desc.focus();
          }
        }
        return;
      }

      // ── Item-level buttons (inside .todo-item) ───────────
      const item = e.target.closest(".todo-item");
      if (!item) return;
      const taskId = Number(item.dataset.id);

      if (e.target.closest(".todo-check")) {
        this.#toggleDayTask(taskId);
        return;
      }
      if (e.target.closest(".todo-delete")) {
        this.#deleteDayTask(taskId);
        return;
      }
      if (e.target.closest(".todo-reassign")) {
        this.#reassignDayTask(taskId);
        return;
      }
      if (e.target.closest(".todo-expand-btn")) {
        this.#toggleExpand(taskId);
        return;
      }
      if (e.target.closest(".todo-detail-save")) {
        const form = e.target.closest(".todo-detail-form");
        if (!form) return;
        const desc = form.querySelector("[data-field=description]").value;
        const priority = form.querySelector("[data-field=priority]").value;
        const url = form.querySelector("[data-field=url]").value;
        this.#updateDayTask(taskId, { description: desc, priority, url });
        return;
      }
      if (e.target.closest(".todo-link-btn")) {
        return;
      }
    });

    // Enter key in abstract input (editorRoot, via document delegation)
    document.addEventListener("keydown", (e) => {
      if (!this.editorRoot || !this.editorRoot.contains(e.target)) return;
      if (e.key === "Enter" && e.target.matches(".cal-day-input-abstract")) {
        e.preventDefault();
        this.#gatherAndAdd();
      }
    });

    // Double-click abstract to inline edit (editorRoot, via document)
    document.addEventListener("dblclick", (e) => {
      if (!this.editorRoot || !this.editorRoot.contains(e.target)) return;
      const abstractEl = e.target.closest(".todo-abstract");
      if (!abstractEl) return;
      const item = abstractEl.closest(".todo-item");
      if (!item) return;
      const taskId = Number(item.dataset.id);
      const tasks = this.tasks[this.selectedDate] || [];
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.completed) return;

      const span = abstractEl;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "todo-edit-input";
      input.value = task.abstract;
      span.replaceWith(input);
      input.focus();
      input.select();

      const commit = () => {
        this.#updateDayTask(taskId, { abstract: input.value });
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { input.blur(); }
        if (ev.key === "Escape") { input.removeEventListener("blur", commit); this.#renderDayEditor(); }
      });
    });
  }

  /** Gather values from the day editor form and add a task. */
  #gatherAndAdd() {
    if (!this.selectedDate || !this.editorRoot) return;
    const abstractInput = this.editorRoot.querySelector(".cal-day-input-abstract");
    if (!abstractInput) return;
    const abstract = abstractInput.value;
    if (!abstract.trim()) return;

    const descInput = this.editorRoot.querySelector(".cal-day-input-desc");
    const prioritySelect = this.editorRoot.querySelector(".cal-day-input-priority");
    const urlInput = this.editorRoot.querySelector(".cal-day-input-url");

    this.#addDayTask({
      abstract,
      description: descInput ? descInput.value : "",
      priority: prioritySelect ? prioritySelect.value : "none",
      url: urlInput ? urlInput.value : "",
    });

    abstractInput.value = "";
    if (descInput) descInput.value = "";
    if (prioritySelect) prioritySelect.value = "none";
    if (urlInput) urlInput.value = "";

    const advancedRow = this.editorRoot.querySelector(".cal-day-input-advanced");
    const expandBtn = this.editorRoot.querySelector(".cal-day-input-expand");
    if (advancedRow) advancedRow.classList.remove("visible");
    if (expandBtn) expandBtn.classList.remove("active");
    abstractInput.focus();
  }
}
