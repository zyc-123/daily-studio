/**
 * LongTerm — hierarchical long-term task manager.
 *
 * Each root task is a tree of sub-tasks (max depth 5).  Only leaf
 * nodes can be scheduled to a calendar date; scheduled leaves appear
 * as todo items on the target day.
 */
class LongTerm {

  constructor(rootId) {
    this.root = document.getElementById(rootId);
    this.tasks = [];          // array of root tasks
    this.editingId = null;    // -1 = new root, >0 = edit existing node
    this.parentId = null;     // parent node id when adding a child
    this.expanded = new Set(); // ids of nodes whose children are visible
  }

  init() {
    this.tasks = LongTermStorage.loadAll();
    // Expand root tasks by default
    for (const t of this.tasks) this.expanded.add(t.id);
    this.#render();
    this.#bindEvents();
  }

  /** Refresh the panel after a linked calendar task changes. */
  refresh() {
    this.tasks = LongTermStorage.loadAll();
    for (const task of this.tasks) this.expanded.add(task.id);
    this.#render();
  }

  /** Expand the ancestors of a task and bring its row into view. */
  focusTask(id) {
    if (!this.#expandPath(this.tasks, id)) return false;
    this.editingId = null;
    this.parentId = null;
    this.#render();
    requestAnimationFrame(() => {
      const row = this.root.querySelector(`.lt-node[data-id="${id}"]`);
      if (!row) return;
      row.classList.add("lt-node-focused");
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => row.classList.remove("lt-node-focused"), 1800);
    });
    return true;
  }

  // ── Render ─────────────────────────────────────────────────

  #render() {
    this.root.innerHTML = this.#panelHTML();
  }

  #panelHTML() {
    const header =
      `<div class="lt-header">
        <h2 class="lt-title">Long-Term Tasks</h2>
        <button class="lt-add-root-btn" data-action="add-root" title="Add long-term task">+</button>
      </div>`;

    if (this.tasks.length === 0 && this.editingId === null) {
      return header + `
        <div class="lt-empty">
          <p>No long-term tasks yet. Add one to start planning.</p>
        </div>`;
    }

    let html = header;

    // Add-root form
    if (this.editingId === -1 && this.parentId === null) {
      html += this.#formHTML(null, 0);
    }

    // Render each root task
    for (const task of this.tasks) {
      html += this.#treeHTML(task, 0);
    }

    return html;
  }

  /** Recursively render a task node and its children. */
  #treeHTML(node, depth) {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = this.expanded.has(node.id);
    const isLeaf = !hasChildren;
    const canGoDeeper = depth < CONFIG.longtermMaxDepth - 1;
    const maxDepth = CONFIG.longtermMaxDepth;

    const totalLeaves = LongTermStorage.countLeaves(node);
    const scheduledLeaves = LongTermStorage.countScheduled(node);
    const isRoot = depth === 0;

    // Chevron only if node has children
    const chevronHTML = hasChildren
      ? `<button class="lt-chevron${isExpanded ? " expanded" : ""}" data-action="expand" data-id="${node.id}"
           title="${isExpanded ? "Collapse" : "Expand"}">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
             <polyline points="9 18 15 12 9 6" />
           </svg></button>`
      : `<span class="lt-chevron-placeholder"></span>`;

    // Priority bar
    const prio = node.priority || "none";
    const prioBar = `<span class="lt-priority" data-priority="${prio}" title="${prio}"></span>`;

    // Abstract
    const abstractHTML = this.#escape(node.abstract || "Untitled");

    // Scheduled badge
    let schedHTML = "";
    if (isLeaf && node.scheduledDate) {
      schedHTML = `<span class="lt-scheduled-badge" title="Scheduled for ${node.scheduledDate}">
        📅 ${node.scheduledDate}</span>`;
    }

    // Progress bar inline (root only, same line as name)
    let progressHTML = "";
    if (isRoot && totalLeaves > 0) {
      const pct = Math.round((scheduledLeaves / totalLeaves) * 100);
      progressHTML = `<div class="lt-progress-inline">
        <div class="lt-progress-bar">
          <div class="lt-progress-fill" style="width:${pct}%"></div>
        </div>
        <span class="lt-progress-label">${scheduledLeaves}/${totalLeaves}</span>
      </div>`;
    }

    // Actions
    let actionsHTML = "";
    actionsHTML += `<button class="lt-action-btn lt-edit-btn" data-action="edit" data-id="${node.id}"
      title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg></button>`;
    if (isLeaf) {
      actionsHTML += `<button class="lt-action-btn lt-schedule-btn" data-action="schedule" data-id="${node.id}"
        title="${node.scheduledDate ? "Change date / Unschedule" : "Schedule to a day"}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg></button>`;
    }
    if (canGoDeeper) {
      actionsHTML += `<button class="lt-action-btn lt-add-child-btn" data-action="add-child" data-id="${node.id}"
        title="Add sub-task"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        width="14" height="14"><line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" /></svg></button>`;
    }
    actionsHTML += `<button class="lt-action-btn lt-delete-btn" data-action="delete" data-id="${node.id}"
      title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      width="14" height="14"><line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" /></svg></button>`;

    let html = `<div class="lt-tree">`;
    html += `<div class="lt-node${isRoot ? " lt-node-root" : ""}" data-depth="${depth}" data-id="${node.id}">
      ${chevronHTML}${prioBar}
      <span class="lt-abstract">${abstractHTML}</span>
      ${schedHTML}
      ${progressHTML}
      <span class="lt-actions">${actionsHTML}</span>
    </div>`;

    // Editing form (if this node is being edited)
    if (this.editingId === node.id) {
      html += this.#formHTML(node, depth + 1);
    }

    // Add-child form (if adding a child to this node)
    if (this.editingId === -1 && this.parentId === node.id) {
      html += this.#formHTML(null, depth + 1);
    }

    // Children
    if (hasChildren) {
      html += `<div class="lt-children${isExpanded ? "" : " collapsed"}">`;
      for (const child of node.children) {
        html += this.#treeHTML(child, depth + 1);
      }
      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  // ── Form ───────────────────────────────────────────────────

  #formHTML(node, depth) {
    const isEdit = node !== null;
    const abstract = isEdit ? this.#escapeAttr(node.abstract || "") : "";
    const desc = isEdit ? this.#escape(node.description || "") : "";
    const prio = isEdit ? (node.priority || "none") : "none";

    const prioOptions = ["none", "high", "medium", "low"]
      .map(p => `<option value="${p}"${p === prio ? " selected" : ""}>${p}</option>`).join("");

    return `
      <div class="lt-form" data-depth="${depth}">
        <div class="lt-form-row">
          <input class="lt-input-abstract" type="text" placeholder="Task name…"
            value="${abstract}" maxlength="200" />
        </div>
        <div class="lt-form-row">
          <textarea class="lt-input-desc" placeholder="Description (optional)…" rows="2">${desc}</textarea>
        </div>
        <div class="lt-form-row lt-form-actions">
          <select class="lt-input-priority">${prioOptions}</select>
          <button class="lt-form-save" data-action="form-save">Save</button>
          <button class="lt-form-cancel" data-action="form-cancel">Cancel</button>
        </div>
      </div>`;
  }

  // ── Event binding ──────────────────────────────────────────

  #bindEvents() {
    this.root.addEventListener("click", (e) => {
      const action = e.target.closest("[data-action]");
      if (!action) return;
      const id = action.dataset.id ? Number(action.dataset.id) : null;
      const act = action.dataset.action;

      switch (act) {
        case "expand":
          this.#toggleExpand(id);
          break;
        case "schedule":
          this.#scheduleNode(id);
          break;
        case "add-root":
          this.editingId = -1;
          this.parentId = null;
          this.#render();
          break;
        case "add-child":
          this.editingId = -1;
          this.parentId = id;
          this.#render();
          break;
        case "edit":
          this.editingId = id;
          this.parentId = null;
          this.#render();
          break;
        case "delete":
          this.#deleteNode(id);
          break;
        case "form-save":
          e.preventDefault();
          this.#saveForm();
          break;
        case "form-cancel":
          this.editingId = null;
          this.parentId = null;
          this.#render();
          break;
      }
    });

    // Enter key in form inputs
    this.root.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches(".lt-input-abstract")) {
        e.preventDefault();
        this.#saveForm();
      }
    });
  }

  // ── CRUD ───────────────────────────────────────────────────

  #nextId() {
    let max = 0;
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.id > max) max = n.id;
        if (n.children) walk(n.children);
      }
    };
    walk(this.tasks);
    return max + 1;
  }

  #saveForm() {
    const abstract = this.root.querySelector(".lt-input-abstract")?.value.trim();
    if (!abstract) return;

    const desc = this.root.querySelector(".lt-input-desc")?.value.trim() || "";
    const prio = this.root.querySelector(".lt-input-priority")?.value || "none";

    if (this.editingId > 0) {
      // Edit existing node
      const node = LongTermStorage.findNode(this.tasks, this.editingId);
      if (node) {
        node.abstract = abstract;
        node.description = desc;
        node.priority = prio;
      }
    } else if (this.editingId === -1) {
      // Add new node
      const newNode = {
        id: this.#nextId(),
        abstract,
        description: desc,
        priority: prio,
        children: [],
        scheduledDate: null,
        createdAt: new Date().toISOString(),
      };

      if (this.parentId !== null) {
        const parent = LongTermStorage.findNode(this.tasks, this.parentId);
        if (parent) {
          if (!parent.children) parent.children = [];
          parent.children.push(newNode);
          this.expanded.add(parent.id); // auto-expand parent
        }
      } else {
        this.tasks.push(newNode);
        this.expanded.add(newNode.id);
      }
    }

    this.editingId = null;
    this.parentId = null;
    const syncedCalendarTasks = this.#syncLinkedCalendarTasks();
    this.#persist();
    if (syncedCalendarTasks) {
      document.dispatchEvent(new CustomEvent("longterm:changed", { bubbles: true }));
    }
  }

  #deleteNode(id) {
    const node = LongTermStorage.findNode(this.tasks, id);
    if (!node) return;

    // Collect and unschedule all leaf descendants
    const scheduled = LongTermStorage.collectScheduled(node);
    if (scheduled.length > 0) {
      const msg = scheduled.length === 1
        ? "This will also remove it from the calendar. Continue?"
        : `This will unschedule ${scheduled.length} tasks from the calendar. Continue?`;
      if (!confirm(msg)) return;
      for (const s of scheduled) {
        CalendarStorage.deleteTaskByLongTermId(s.date, s.id);
      }
    }

    // Remove from parent
    this.#removeFromTree(this.tasks, id);
    this.expanded.delete(id);
    this.#persist();
    // Refresh calendar if we changed anything
    if (scheduled.length > 0) {
      document.dispatchEvent(new CustomEvent("longterm:changed", { bubbles: true }));
    }
  }

  /** Remove a node by id from the tree (mutates in place). Returns true if removed. */
  #removeFromTree(nodes, id) {
    const idx = nodes.findIndex(n => n.id === id);
    if (idx >= 0) { nodes.splice(idx, 1); return true; }
    for (const n of nodes) {
      if (n.children && this.#removeFromTree(n.children, id)) return true;
    }
    return false;
  }

  #expandPath(nodes, id, ancestors = []) {
    for (const node of nodes) {
      if (node.id === id) {
        ancestors.forEach((ancestorId) => this.expanded.add(ancestorId));
        return true;
      }
      if (node.children && this.#expandPath(node.children, id, [...ancestors, node.id])) {
        this.expanded.add(node.id);
        return true;
      }
    }
    return false;
  }

  // ── Expand / Collapse ─────────────────────────────────────

  #toggleExpand(id) {
    if (this.expanded.has(id)) {
      this.expanded.delete(id);
    } else {
      this.expanded.add(id);
    }
    this.#render();
  }

  // ── Scheduling ─────────────────────────────────────────────

  #scheduleNode(id) {
    const node = LongTermStorage.findNode(this.tasks, id);
    if (!node) return;
    // Only leaf nodes can be scheduled
    if (node.children && node.children.length > 0) return;

    // Full path from root to leaf as the todo name
    const taskName = LongTermStorage.getNodePath(this.tasks, id);

    if (node.scheduledDate) {
      // Already scheduled — offer to change or unschedule
      const newDate = prompt(
        `Scheduled for ${node.scheduledDate}.\nEnter a new date (YYYY-MM-DD) or leave blank to unschedule:`,
        node.scheduledDate
      );
      if (newDate === null) return; // cancelled

      if (newDate.trim() === "") {
        // Unschedule
        CalendarStorage.deleteTaskByLongTermId(node.scheduledDate, id);
        node.scheduledDate = null;
      } else {
        // Change date
        CalendarStorage.deleteTaskByLongTermId(node.scheduledDate, id);
        node.scheduledDate = newDate.trim();
        CalendarStorage.addTask(node.scheduledDate, {
          abstract: taskName,
          description: node.description || "",
          priority: node.priority || "none",
          url: "",
          completed: false,
        }, id); // pass longterm id so we can track it
      }
    } else {
      // Not yet scheduled — ask for date
      const today = new Date().toISOString().slice(0, 10);
      const dateStr = prompt("Schedule to which date? (YYYY-MM-DD)", today);
      if (!dateStr || !dateStr.trim()) return;

      node.scheduledDate = dateStr.trim();
      CalendarStorage.addTask(node.scheduledDate, {
        abstract: taskName,
        description: node.description || "",
        priority: node.priority || "none",
        url: "",
        completed: false,
      }, id);
    }

    this.#persist();
    // Notify calendar to refresh
    document.dispatchEvent(new CustomEvent("longterm:changed", { bubbles: true }));
  }

  // ── Helpers ────────────────────────────────────────────────

  #syncLinkedCalendarTasks() {
    let updated = false;
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.children?.length) {
          walk(node.children);
          continue;
        }
        updated = CalendarStorage.updateTasksByLongTermId(node.id, {
          abstract: LongTermStorage.getNodePath(this.tasks, node.id),
          description: node.description || "",
          priority: node.priority || "none",
        }) || updated;
      }
    };
    walk(this.tasks);
    return updated;
  }

  #persist() {
    LongTermStorage.saveAll(this.tasks);
    this.#render();
  }

  #escape(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  #escapeAttr(str) {
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
