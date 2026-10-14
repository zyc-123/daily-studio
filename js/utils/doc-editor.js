/**
 * DocEditor — the one text editor, shared by docs files and the work log.
 *
 * The caller supplies what differs:
 *   container  where to mount
 *   text       starting content
 *   variant    "file" | "log" — a class hook, so the two look unlike
 *              each other while behaving identically
 *   toolbar    which format buttons to show
 *   onSave     returns a promise; omit it and no save bar is drawn
 *   onDirty    lets a caller mirror the text into its own state
 *
 * Everything else — the formatting rules, the Edit/Preview switch, the
 * keyboard shortcuts — lives here once.
 */
class DocEditor {

  static #FORMATS = {
    heading: { label: "H", title: "Heading", wrap: ["## ", ""], block: true },
    bold: { label: "<strong>B</strong>", title: "Bold", wrap: ["**", "**"] },
    italic: { label: "<em>I</em>", title: "Italic", wrap: ["*", "*"] },
    list: { label: "List", title: "Bulleted list", prefix: "- ", block: true },
    ordered: { label: "1.", title: "Numbered list", prefix: "1. ", block: true },
    link: { label: "Link", title: "Link", wrap: ["[", "](https://)"] },
    task: { label: "Task", title: "Calendar task", insert: "[[task:calendar:YYYY-MM-DD:1|Label]]" },
    // `pick` means the snippet comes from the caller — it has to upload
    // first, so the editor asks and inserts whatever comes back.
    image: { label: "Image", title: "Insert image", pick: true },
    issue: { label: "Issue", title: "Problem block",
             insert: ":::issue issue-id Open\nDescribe it.\n:::end issue-id" },
    code: { label: "Code", title: "Code block", insert: "```\n\n```" },
  };

  static #DEFAULT_TOOLBAR = ["heading", "bold", "italic", "list", "ordered", "link", "image", "code"];

  /**
   * Mount an editor into `opts.container`. Returns a handle with
   * `value()`, `destroy()` and `revert()`.
   */
  static open(opts) {
    const container = opts.container;
    const toolbar = opts.toolbar || this.#DEFAULT_TOOLBAR;
    const variant = opts.variant || "file";
    let text = opts.text == null ? "" : String(opts.text);
    let mode = "edit";                       // "edit" | "preview"

    container.classList.add("doc-editor", "doc-editor--" + variant);
    container.innerHTML = "";

    // ── tabs ──
    const tabs = document.createElement("div");
    tabs.className = "doc-editor-tabs";
    for (const [key, label] of [["edit", "Edit"], ["preview", "Preview"]]) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "doc-editor-tab";
      tab.dataset.mode = key;
      tab.textContent = label;
      tabs.appendChild(tab);
    }

    // ── format bar ──
    const bar = document.createElement("div");
    bar.className = "doc-editor-bar";
    for (const key of toolbar) {
      const format = this.#FORMATS[key];
      if (!format) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "doc-editor-format";
      btn.dataset.format = key;
      btn.title = format.title;
      btn.innerHTML = format.label;
      bar.appendChild(btn);
    }

    const surface = document.createElement("div");
    surface.className = "doc-editor-surface";

    const area = document.createElement("textarea");
    area.className = "doc-editor-area";
    area.spellcheck = false;

    const preview = document.createElement("article");
    preview.className = "doc-editor-preview markdown-body";

    surface.append(area, preview);

    const foot = document.createElement("div");
    foot.className = "doc-editor-foot";
    if (opts.onSave) {
      const hint = document.createElement("span");
      hint.className = "doc-editor-hint";
      hint.textContent = "Ctrl/⌘ + S to save";

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "doc-editor-btn";
      cancel.textContent = "Cancel";

      const save = document.createElement("button");
      save.type = "button";
      save.className = "doc-editor-btn doc-editor-btn--primary";
      save.textContent = "Save";

      foot.append(hint, cancel, save);

      cancel.addEventListener("click", () => opts.onCancel && opts.onCancel());
      save.addEventListener("click", () => commit(save));
    }

    container.append(tabs, bar, surface, foot);

    // ── behaviour ──
    const paint = () => {
      container.classList.toggle("is-preview", mode === "preview");
      tabs.querySelectorAll(".doc-editor-tab").forEach((tab) => {
        tab.classList.toggle("is-active", tab.dataset.mode === mode);
      });
      if (mode === "preview") preview.innerHTML = Markdown.toHtml(text);
    };

    const setText = (next) => {
      text = next;
      area.value = next;
      if (opts.onDirty) opts.onDirty(next);
      if (mode === "preview") paint();
    };

    async function commit(button) {
      if (button.disabled) return;
      button.disabled = true;
      try {
        await opts.onSave(text);
      } catch (error) {
        button.disabled = false;
        if (opts.onError) opts.onError(error.message);
      }
    }

    tabs.addEventListener("click", (ev) => {
      const tab = ev.target.closest(".doc-editor-tab");
      if (!tab) return;
      mode = tab.dataset.mode;
      paint();
    });

    bar.addEventListener("click", async (ev) => {
      const btn = ev.target.closest(".doc-editor-format");
      if (!btn) return;
      const format = this.#FORMATS[btn.dataset.format];

      if (format && format.pick) {
        if (!opts.onPick) return;
        btn.disabled = true;
        try {
          // The caller uploads and hands back the Markdown to insert;
          // a cancelled pick returns nothing and changes nothing.
          const snippet = await opts.onPick(btn.dataset.format);
          if (snippet) this.#insert(area, setText, snippet);
        } catch (error) {
          if (opts.onError) opts.onError(error.message);
        } finally {
          btn.disabled = false;
        }
        area.focus();
        return;
      }

      this.#apply(area, setText, btn.dataset.format);
      area.focus();
    });

    area.addEventListener("input", () => setText(area.value));

    const onKey = (ev) => {
      if (!area.isConnected) return;
      if (ev.key === "s" && (ev.metaKey || ev.ctrlKey) && opts.onSave) {
        ev.preventDefault();
        commit(foot.querySelector(".doc-editor-btn--primary"));
        return;
      }
      if (ev.key === "Tab") { ev.preventDefault(); this.#insert(area, setText, "  "); }
    };
    area.addEventListener("keydown", onKey);

    area.value = text;
    paint();

    return {
      value: () => text,
      setValue: setText,
      preview: () => { mode = "preview"; paint(); },
      destroy: () => { area.removeEventListener("keydown", onKey); container.innerHTML = ""; },
    };
  }

  /** Apply one format button to the current selection. */
  static #apply(area, setText, key) {
    const format = this.#FORMATS[key];
    if (!format) return;

    if (format.insert) { this.#insert(area, setText, format.insert); return; }

    const start = area.selectionStart;
    const end = area.selectionEnd;
    const selected = area.value.slice(start, end);

    if (format.prefix) {
      // Prefix the lines the selection touches.
      const from = area.value.lastIndexOf("\n", start - 1) + 1;
      let to = area.value.indexOf("\n", end);
      if (to === -1) to = area.value.length;
      const block = area.value.slice(from, to) || "";
      const prefixed = (block || "item")
        .split("\n")
        .map((line) => (line.startsWith(format.prefix) ? line : format.prefix + line))
        .join("\n");
      const next = area.value.slice(0, from) + prefixed + area.value.slice(to);
      setText(next);
      area.setSelectionRange(from, from + prefixed.length);
      return;
    }

    const [open, close] = format.wrap;
    const body = selected || (key === "link" ? "label" : "text");
    const next = area.value.slice(0, start) + open + body + close + area.value.slice(end);
    setText(next);
    area.setSelectionRange(start + open.length, start + open.length + body.length);
  }

  /** Splice text in at the caret, dodging an accidental run-together. */
  static #insert(area, setText, snippet) {
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const before = area.value.slice(0, start);
    const after = area.value.slice(end);
    const lead = before && !/\n$/.test(before) ? "\n" : "";
    const tail = after && !/^\n/.test(after) ? "\n" : "";
    setText(before + lead + snippet + tail + after);
    const caret = start + lead.length + snippet.length;
    area.setSelectionRange(caret, caret);
  }
}
