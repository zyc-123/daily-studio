/**
 * LongTermStorage — persistence layer for long-term task trees.
 *
 * Data shape: array of root tasks, each with nested `children`.
 *   [{ id, abstract, description, priority, children: [...], scheduledDate, createdAt }, ...]
 */
class LongTermStorage {

  /** Load all root tasks from localStorage. */
  static loadAll() {
    return Storage.load(CONFIG.longtermStorageKey, []);
  }

  /** Save the entire root tasks array to localStorage. */
  static saveAll(tasks) {
    Storage.save(CONFIG.longtermStorageKey, tasks);
  }

  // ── Recursive tree helpers ─────────────────────────────────

  /** Depth-first search for a node by id. Returns the node or null. */
  static findNode(tasks, id) {
    for (const task of tasks) {
      if (task.id === id) return task;
      if (task.children && task.children.length) {
        const found = this.findNode(task.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  /** Count all leaf nodes (no children) in a subtree. */
  static countLeaves(node) {
    if (!node.children || node.children.length === 0) return 1;
    return node.children.reduce((sum, child) => sum + this.countLeaves(child), 0);
  }

  /** Count leaf nodes that have a scheduledDate set. */
  static countScheduled(node) {
    if (!node.children || node.children.length === 0) {
      return node.scheduledDate ? 1 : 0;
    }
    return node.children.reduce((sum, child) => sum + this.countScheduled(child), 0);
  }

  /** Find the depth of a node by id (root depth = 0). Returns -1 if not found. */
  static getDepth(tasks, id, depth) {
    if (depth === undefined) depth = 0;
    for (const task of tasks) {
      if (task.id === id) return depth;
      if (task.children && task.children.length) {
        const found = this.getDepth(task.children, id, depth + 1);
        if (found >= 0) return found;
      }
    }
    return -1;
  }

  /** Find the root task that contains the given node id. */
  static findRoot(tasks, id) {
    for (const root of tasks) {
      if (root.id === id) return root;
      if (root.children && root.children.length) {
        if (this.findNode(root.children, id)) return root;
      }
    }
    return null;
  }

  /** Return the path of node names from root to the given node id, joined by " / ". */
  static getNodePath(tasks, id) {
    const path = [];
    this.#buildPath(tasks, id, path);
    return path.reverse().join(" / ");
  }

  /** Recursive helper: push ancestor names onto path array working upward. */
  static #buildPath(nodes, id, path) {
    for (const node of nodes) {
      if (node.id === id) { path.push(node.abstract); return true; }
      if (node.children && node.children.length) {
        if (this.#buildPath(node.children, id, path)) {
          path.push(node.abstract);
          return true;
        }
      }
    }
    return false;
  }

  /** Recursively collect all scheduled leaf nodes (for cleanup on delete). */
  static collectScheduled(node, out) {
    if (!out) out = [];
    if (!node.children || node.children.length === 0) {
      if (node.scheduledDate) out.push({ id: node.id, date: node.scheduledDate });
      return out;
    }
    for (const child of node.children) {
      this.collectScheduled(child, out);
    }
    return out;
  }
}
