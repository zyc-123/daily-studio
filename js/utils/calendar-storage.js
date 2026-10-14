/**
 * CalendarStorage — date-keyed task persistence.
 *
 * Data shape stored under CONFIG.calendarStorageKey:
 *   { "2026-08-03": [task, ...], "2026-08-04": [...], ... }
 *
 * Each task follows the same model as TodoList.
 */
class CalendarStorage {

  /** Load the full calendar object. */
  static loadAll() {
    return Storage.load(CONFIG.calendarStorageKey, {});
  }

  /** Save the full calendar object. */
  static saveAll(data) {
    Storage.save(CONFIG.calendarStorageKey, data);
  }

  /** Get tasks for a specific date (returns a defensive copy). */
  static getTasks(dateStr) {
    const all = this.loadAll();
    return (all[dateStr] || []).slice();
  }

  /** Replace tasks for a specific date. */
  static setTasks(dateStr, tasks) {
    const all = this.loadAll();
    if (tasks.length === 0) {
      delete all[dateStr];
    } else {
      all[dateStr] = tasks.slice();
    }
    this.saveAll(all);
  }

  /** Add one task to a date, returns the new task with id assigned. */
  static addTask(dateStr, task, longtermId) {
    const tasks = this.getTasks(dateStr);
    const nextId = tasks.length > 0
      ? Math.max(...tasks.map((t) => t.id)) + 1
      : 1;
    const created = { ...task, id: nextId, createdAt: new Date().toISOString() };
    if (longtermId !== undefined) created.longtermId = longtermId;
    tasks.push(created);
    this.setTasks(dateStr, tasks);
    return created;
  }

  /** Delete a task by its longtermId field (for unscheduling). Returns true if found. */
  static deleteTaskByLongTermId(dateStr, longtermId) {
    const tasks = this.getTasks(dateStr);
    const idx = tasks.findIndex((t) => t.longtermId === longtermId);
    if (idx === -1) return false;
    tasks.splice(idx, 1);
    this.setTasks(dateStr, tasks);
    return true;
  }

  /** Update a task by id. */
  static updateTask(dateStr, taskId, changes) {
    const tasks = this.getTasks(dateStr);
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return false;
    Object.assign(tasks[idx], changes);
    this.setTasks(dateStr, tasks);
    return true;
  }

  /** Update all calendar copies associated with one long-term task. */
  static updateTasksByLongTermId(longtermId, changes) {
    const all = this.loadAll();
    let updated = false;
    for (const tasks of Object.values(all)) {
      for (const task of tasks) {
        if (task.longtermId !== longtermId) continue;
        Object.assign(task, changes);
        updated = true;
      }
    }
    if (updated) this.saveAll(all);
    return updated;
  }

  /** Delete a task by id. */
  static deleteTask(dateStr, taskId) {
    const tasks = this.getTasks(dateStr).filter((t) => t.id !== taskId);
    this.setTasks(dateStr, tasks);
  }

  /** Toggle completion of a task by id. */
  static toggleTask(dateStr, taskId) {
    const tasks = this.getTasks(dateStr);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return false;
    task.completed = !task.completed;
    this.setTasks(dateStr, tasks);
    return true;
  }

  /** Get total stats for a date. */
  static getStats(dateStr) {
    const tasks = this.getTasks(dateStr);
    const total = tasks.length;
    const done = tasks.filter((t) => t.completed).length;
    return { total, done, remaining: total - done };
  }

  /** Get all dates that have at least one task. */
  static getActiveDates(year, month) {
    const all = this.loadAll();
    const prefix = `${year}-${String(month).padStart(2, "0")}-`;
    return Object.keys(all).filter((k) => k.startsWith(prefix));
  }
}
