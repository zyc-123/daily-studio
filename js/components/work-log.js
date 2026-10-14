/**
 * WorkLog — a persisted Markdown work journal with editor and preview modes.
 */
class WorkLog {
  constructor(rootId) {
    this.root = document.getElementById(rootId);
    this.libraryRoot = document.getElementById("worklog-library-section");
    this.issuesRoot = document.getElementById("worklog-issues-panel");
    this.documents = [];
    this.selectedId = null;
    this.selection = new Set();
    this.selectionAnchorId = null;
    this.mode = "edit";
    this.issuesPanelOpen = false;
    this.issueDocumentSelection = new Set();
    this.issueStatusSelection = new Set(["Open", "Completed"]);
    this.contextMenu = null;
    this.imageStatus = "";
    this.saveTimer = null;
    this.relationshipFrame = null;
    this.relationshipObserver = null;
    this.referencePickerOpen = false;
    this.referencePreview = null;
    this.editorSelection = null;
    this.referenceTreeExpanded = new Set();
    this.referenceGlobalQuery = "";
    this.referenceCalendarQuery = "";
    this.resourceDialogOpen = false;
    this.resourceMode = "url";
    this.resourceUrl = "";
    this.resourcePath = "";
    this.resourceLabel = "";
    this.resourceSelection = null;
    this.resourcePreview = null;
    this.resourceZoom = 1;
    this.resourceCopyOnInsert = false;
    this.resourceCopying = false;
    this.assetCleanupBusy = false;
    this.assetCleanupMessage = "";
    this.assetCleanupDialogOpen = false;
    this.assetCleanupFiles = [];
    this.assetCleanupSelected = new Set();
    this.assetCleanupError = "";
    this.assetPreview = null;
    this.pageMarkerObserver = null;
    this.pageMarkerTimer = null;
    this.pageMarkerToken = null;
    this.expandedImages = new Map();
  }

  init() {
    const saved = Storage.load(CONFIG.worklogStorageKey, { documents: [], selectedId: null });
    this.#loadDocuments(saved);
    this.issueDocumentSelection = new Set(this.documents.map((document) => document.id));
    if (this.selectedId !== null) {
      this.selection.add(this.selectedId);
      this.selectionAnchorId = this.selectedId;
    }
    this.#render();
    this.#bindEvents();
  }

  #loadDocuments(saved) {
    if (Array.isArray(saved.documents)) {
      this.documents = saved.documents.filter((document) => document && typeof document.title === "string");
      this.selectedId = this.documents.some((document) => document.id === saved.selectedId)
        ? saved.selectedId
        : this.documents[0]?.id || null;
      return;
    }
    if (typeof saved.content === "string" && saved.content.trim()) {
      const id = Date.now();
      this.documents = [{ id, title: "Untitled work log", content: saved.content, createdAt: saved.updatedAt || new Date().toISOString(), updatedAt: saved.updatedAt || new Date().toISOString() }];
      this.selectedId = id;
      this.#persist();
    }
  }

  #selectedDocument() {
    return this.documents.find((document) => document.id === this.selectedId) || null;
  }

  #render() {
    if (!this.root || !this.libraryRoot) return;
    const document = this.#selectedDocument();
    this.root.innerHTML = `
      <section class="worklog-document ${document ? "is-open" : ""}" aria-label="${document ? "Open work log" : "Work log editor"}">${document ? this.#editorHTML(document) : this.#emptyHTML()}</section>
      ${this.referencePickerOpen ? this.#referencePickerHTML() : ""}
      ${this.referencePreview ? this.#referenceCardHTML() : ""}
      ${this.resourceDialogOpen ? this.#resourceDialogHTML() : ""}
      ${this.resourcePreview ? this.#resourcePreviewHTML() : ""}
      ${this.assetCleanupDialogOpen ? this.#assetCleanupDialogHTML() : ""}
      ${this.assetPreview ? this.#assetPreviewHTML() : ""}`;
    this.#observePageMarkerSurfaces();
    this.#renderPageMarkers();
    this.libraryRoot.innerHTML = `
      <nav class="worklog-library" aria-label="Work log documents">
        <div class="worklog-panel-header"><div><p class="worklog-panel-kicker">Control panel</p><h2>Work Logs</h2></div><button class="worklog-new-btn" data-action="new" aria-label="New log" title="New log">+</button></div>
        <button class="worklog-cleanup-btn" data-action="cleanup-assets" ${this.assetCleanupBusy ? "disabled" : ""}>Clean unused assets</button>
        <p class="worklog-cleanup-status" role="status">${this.#escape(this.assetCleanupMessage)}</p>
        <p class="worklog-library-label">All logs</p>
        <div class="worklog-document-list">${this.#documentList(this.documents, "No saved logs")}</div>
        ${document ? `<div class="worklog-open-summary"><span class="worklog-open-marker" aria-hidden="true"></span><div><small>Currently editing</small><strong>${this.#escape(document.title || "Untitled work log")}</strong></div></div>` : ""}
        ${this.contextMenu ? this.#contextMenuHTML() : ""}
      </nav>`;
    this.#renderIssuesPanel();
    if (this.referencePickerOpen) this.#filterReferencePicker();
    this.#scheduleRelationshipRender();
  }

  #observePageMarkerSurfaces() {
    if (!this.pageMarkerObserver) return;
    this.pageMarkerObserver.disconnect();
    for (const surface of this.root.querySelectorAll(".worklog-editor, .worklog-preview.visible")) {
      this.pageMarkerObserver.observe(surface);
    }
  }

  #renderPageMarkers() {
    const layer = this.root?.querySelector(".worklog-page-markers");
    if (!layer) return;
    const workLog = this.#selectedDocument();
    if (!workLog || typeof WorkLogPdf === "undefined") { layer.replaceChildren(); return; }
    const token = Symbol("page-markers");
    this.pageMarkerToken = token;
    Promise.resolve()
      .then(() => WorkLogPdf.pageBreaks({
        title: workLog.title || "Untitled work log",
        updatedAt: new Date(workLog.updatedAt).toLocaleString(),
        markdown: workLog.content || "",
      }))
      .then((breaks) => {
        // A newer render has started, or the selection changed meanwhile.
        if (this.pageMarkerToken !== token || this.#selectedDocument() !== workLog) return;
        layer.replaceChildren();
        if (!breaks.length) return;
        const visibleSurface = this.mode === "preview"
          ? this.root.querySelector(".worklog-preview.visible")
          : this.root.querySelector(".worklog-editor.visible");
        if (!visibleSurface) return;
        const layerRect = layer.getBoundingClientRect();
        const surfaceRect = visibleSurface.getBoundingClientRect();
        const style = getComputedStyle(visibleSurface);
        const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
        const paddingRight = Number.parseFloat(style.paddingRight) || 0;
        const left = surfaceRect.left - layerRect.left + visibleSurface.clientLeft + paddingLeft;
        const right = layer.clientWidth - (surfaceRect.right - layerRect.left - visibleSurface.clientLeft - paddingRight);
        // In edit mode the marks are measured against the textarea's own text,
        // which needs one mirror pass for every break, so resolve them together.
        const editorTops = this.mode === "edit"
          ? this.#editorMarkerTops(new Map(breaks.map((entry) => [entry.page, [...(entry.image ? [entry.image] : []), ...entry.anchors]])), visibleSurface)
          : new Map();
        let previousTop = -Infinity;
        for (const entry of breaks) {
          let top;
          if (this.mode === "preview") {
            if (entry.image) top = this.#visibleImageAnchorTop(visibleSurface, entry.image, layerRect, previousTop);
            for (const anchor of entry.anchors) {
              if (top !== undefined) break;
              top = this.#visibleTextAnchorTop(visibleSurface, anchor, layerRect, entry.boxStart, previousTop);
            }
          } else {
            top = editorTops.get(entry.page);
            if (top !== undefined) top = surfaceRect.top - layerRect.top + visibleSurface.clientTop + top - visibleSurface.scrollTop;
          }
          if (top === undefined) continue;
          previousTop = top;
          const marker = document.createElement("div");
          marker.className = "worklog-page-marker";
          marker.style.left = `${left}px`;
          marker.style.right = `${right}px`;
          marker.style.top = `${top}px`;
          const label = document.createElement("span");
          label.textContent = `Page ${entry.page}`;
          marker.append(label);
          layer.append(marker);
        }
      })
      .catch(() => { /* markers are decorative: a failure must not break editing */ });
  }

  #schedulePageMarkerRefresh() {
    clearTimeout(this.pageMarkerTimer);
    this.pageMarkerTimer = setTimeout(() => this.#renderPageMarkers(), 120);
  }

  /* Boxed elements the exporter never breaks up. When a page opens on one of
   * them the marker is placed above the box rather than on its text, so the
   * line does not cut through an image, a reference chip or an issue card. */
  static PAGE_MARKER_BOXES = ".worklog-issue, .worklog-task-reference, .worklog-resource-reference, .worklog-image, img";

  #visibleTextAnchorTop(surface, anchorText, layerRect, snapToBox = false, afterTop = -Infinity) {
    const normalizedAnchor = anchorText.replace(/\s+/g, " ").trim();
    if (!normalizedAnchor) return undefined;
    const sample = normalizedAnchor.slice(0, 32);
    const range = document.createRange();
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest(".worklog-issue-label, .worklog-issue-state")) continue;
      const offset = node.nodeValue.replace(/\s+/g, " ").indexOf(sample);
      if (offset < 0) continue;
      const box = snapToBox ? node.parentElement.closest(WorkLog.PAGE_MARKER_BOXES) : null;
      const top = box
        ? box.getBoundingClientRect().top - layerRect.top
        : (() => {
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            return range.getBoundingClientRect().top - layerRect.top;
          })();
      // Anchors repeat in long documents: keep searching past the previous
      // marker so each page lands on its own occurrence.
      if (top >= afterTop - 1) return top;
    }
    return undefined;
  }

  #visibleImageAnchorTop(surface, source, layerRect, afterTop = -Infinity) {
    for (const image of surface.querySelectorAll("img")) {
      if (!image.getAttribute("src") || !image.getAttribute("src").endsWith(source.split("/").pop())) continue;
      const box = image.closest(".worklog-image") || image;
      const top = box.getBoundingClientRect().top - layerRect.top;
      if (top >= afterTop - 1) return top;
    }
    return undefined;
  }

  /* Maps each page break to a line of the Markdown source, then measures that
   * line inside a mirror of the textarea. `anchorsByPage` holds the candidate
   * strings the exporter drew at the top of each page, in page order. */
  #editorMarkerTops(anchorsByPage, editor) {
    const source = editor.value;
    let minimumOffset = 0;
    const anchors = [...anchorsByPage.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([pageNumber, candidates]) => {
        let offset = -1;
        for (const candidate of candidates) {
          offset = this.#findSourceAnchorOffset(source, candidate, minimumOffset);
          if (offset >= 0) break;
        }
        if (offset >= 0) {
          const nextLine = source.indexOf("\n", offset);
          minimumOffset = nextLine >= 0 ? nextLine + 1 : source.length;
        }
        return { pageNumber, offset };
      })
      .filter((anchor) => anchor.offset >= 0);
    if (!anchors.length) return new Map();

    const style = getComputedStyle(editor);
    const mirror = document.createElement("div");
    mirror.style.cssText = `position:fixed;left:-10000px;top:0;box-sizing:border-box;width:${editor.clientWidth}px;padding:${style.padding};border:${style.borderWidth} solid transparent;font:${style.font};letter-spacing:${style.letterSpacing};line-height:${style.lineHeight};white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;visibility:hidden;`;
    const sortedAnchors = [...anchors].sort((left, right) => left.offset - right.offset);
    let cursor = 0;
    for (const anchor of sortedAnchors) {
      mirror.append(document.createTextNode(source.slice(cursor, anchor.offset)));
      const marker = document.createElement("span");
      marker.dataset.pageNumber = String(anchor.pageNumber);
      marker.style.cssText = "display:inline-block;width:0;height:1px;vertical-align:top;";
      mirror.append(marker);
      cursor = anchor.offset;
    }
    mirror.append(document.createTextNode(source.slice(cursor)));
    document.body.append(mirror);
    const tops = new Map([...mirror.querySelectorAll("[data-page-number]")].map((marker) => [Number(marker.dataset.pageNumber), marker.offsetTop]));
    mirror.remove();
    return tops;
  }

  #findSourceAnchorOffset(source, anchorText, minimumOffset = 0) {
    const normalizedAnchor = anchorText.replace(/\s+/g, " ").trim();
    if (!normalizedAnchor) {
      const nextContent = source.slice(minimumOffset).search(/\S/);
      return nextContent < 0 ? source.length : minimumOffset + nextContent;
    }
    const directOffset = source.indexOf(normalizedAnchor, minimumOffset);
    if (directOffset >= 0) return directOffset;
    const sample = normalizedAnchor.slice(0, 32);
    const sampleOffset = sample.length >= 4 ? source.indexOf(sample, minimumOffset) : -1;
    if (sampleOffset >= 0) return sampleOffset;

    let offset = 0;
    for (const line of source.split(/\r?\n/)) {
      const normalizedLine = line
        .replace(/^\s*(?:#{1,3}\s+|[-*>]\s*)/, "")
        .replace(/[\*_`]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (offset >= minimumOffset
        && normalizedLine.length >= 4
        && (normalizedAnchor.includes(normalizedLine) || normalizedLine.includes(normalizedAnchor))) return offset;
      offset += line.length + 1;
    }
    const nextContent = source.slice(minimumOffset).search(/\S/);
    return nextContent < 0 ? -1 : minimumOffset + nextContent;
  }

  #parseIssues(content) {
    const pattern = /^:::issue ([a-zA-Z0-9_-]+) (Open|Completed)\r?\n([\s\S]*?)\r?\n:::end \1[ \t]*$/gm;
    return [...content.matchAll(pattern)].map((match) => ({ id: match[1], status: match[2], content: match[3] }));
  }

  #allIssues() {
    return this.documents.flatMap((document) => this.#parseIssues(document.content || "").map((issue) => ({
      ...issue,
      documentId: document.id,
      documentTitle: document.title || "Untitled work log",
    })));
  }

  #renderIssuesPanel() {
    if (!this.issuesRoot) return;
    const issueCount = this.#allIssues().length;
    this.root.querySelectorAll(".worklog-issues-toggle").forEach((button) => {
      button.setAttribute("aria-expanded", String(this.issuesPanelOpen));
      const count = button.querySelector("span");
      if (count) count.textContent = issueCount;
    });
    this.issuesRoot.hidden = !this.issuesPanelOpen;
    this.issuesRoot.parentElement?.classList.toggle("has-issues", this.issuesPanelOpen);
    if (!this.issuesPanelOpen) return;

    const documents = this.documents.map((document) => {
      const count = this.#parseIssues(document.content || "").length;
      return `<label class="worklog-issue-filter-option"><input type="checkbox" data-issue-filter="document" data-document-id="${document.id}" ${this.issueDocumentSelection.has(document.id) ? "checked" : ""}><span>${this.#escape(document.title || "Untitled work log")}</span><small>${count}</small></label>`;
    }).join("");
    const issues = this.#allIssues().filter((issue) => this.issueDocumentSelection.has(issue.documentId)
      && this.issueStatusSelection.has(issue.status));
    const cards = issues.length ? issues.map((issue) => {
      const issueLines = issue.content.split(/\r?\n/);
      const titleLineIndex = issueLines.findIndex((line) => line.trim());
      const titleLine = titleLineIndex >= 0 ? issueLines[titleLineIndex] : "Untitled issue";
      const title = titleLine.replace(/^#{1,6}\s*/, "").replace(/[\*_`]/g, "").trim() || "Untitled issue";
      if (titleLineIndex >= 0) issueLines.splice(titleLineIndex, 1);
      const bodyContent = issueLines.join("\n").trim();
      const nextState = issue.status === "Open" ? "Completed" : "Open";
      return `<article class="worklog-issue-board-card"><header><div><span class="worklog-issue-source">${this.#escape(issue.documentTitle)}</span><button class="worklog-issue-title" data-action="open-issue-log" data-document-id="${issue.documentId}" data-issue-id="${issue.id}">${this.#escape(title)}</button></div><span class="worklog-issue-state is-${issue.status.toLowerCase()}">${issue.status}</span></header><div class="worklog-issue-board-content">${this.#toMarkdown(bodyContent, false, issue.documentId) || '<p class="worklog-issues-empty">No details yet.</p>'}</div><footer><button data-action="toggle-issue-state" data-document-id="${issue.documentId}" data-issue-id="${issue.id}">Mark ${nextState.toLowerCase()}</button><button class="worklog-issue-delete" data-action="delete-issue" data-document-id="${issue.documentId}" data-issue-id="${issue.id}">Delete</button></footer></article>`;
    }).join("") : '<p class="worklog-issues-empty">No problems match these filters.</p>';

    this.issuesRoot.innerHTML = `<header class="worklog-issues-header"><div><p>Work log overview</p><h2>Problems <span>${issues.length}</span></h2></div><button class="worklog-issues-close" data-action="toggle-issues" aria-label="Close problems panel" title="Close">&times;</button></header><div class="worklog-issues-filters"><fieldset><legend>Logs</legend><div class="worklog-issue-filter-list">${documents || '<small>No log files</small>'}</div></fieldset><fieldset><legend>Status</legend><label class="worklog-issue-filter-option"><input type="checkbox" data-issue-filter="status" data-status="Open" ${this.issueStatusSelection.has("Open") ? "checked" : ""}><span>Open</span></label><label class="worklog-issue-filter-option"><input type="checkbox" data-issue-filter="status" data-status="Completed" ${this.issueStatusSelection.has("Completed") ? "checked" : ""}><span>Completed</span></label></fieldset></div><div class="worklog-issues-list">${cards}</div>`;
    this.#positionIssuesPanel();
  }

  #positionIssuesPanel() {
    if (!this.issuesPanelOpen || !this.issuesRoot || this.issuesRoot.hidden) return;
    const anchor = this.root.querySelector(".worklog-document") || this.root;
    const bounds = anchor.getBoundingClientRect();
    const panelWidth = Math.min(420, window.innerWidth - 24);
    const maxLeft = window.innerWidth - panelWidth - 12;
    const left = Math.max(12, Math.min(bounds.right + 12, maxLeft));
    const panelHeight = Math.min(700, window.innerHeight * 0.82);
    const maxTop = Math.max(12, window.innerHeight - panelHeight - 12);
    const top = Math.max(12, Math.min(bounds.top, maxTop));
    this.issuesRoot.style.left = `${left}px`;
    this.issuesRoot.style.top = `${top}px`;
    this.issuesRoot.style.maxHeight = `${Math.max(180, window.innerHeight - top - 24)}px`;
  }

  #insertIssueBlock() {
    const document = this.#selectedDocument();
    if (!document) return;
    if (this.mode !== "edit") {
      this.mode = "edit";
      this.#render();
    }
    const editor = this.root.querySelector(".worklog-editor");
    if (!editor) return;
    const start = editor.selectionStart ?? editor.value.length;
    const end = editor.selectionEnd ?? start;
    const prefix = start > 0 && editor.value[start - 1] !== "\n" ? "\n\n" : "";
    const suffix = end < editor.value.length && editor.value[end] !== "\n" ? "\n\n" : "";
    const id = `issue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const title = "New issue";
    const block = `:::issue ${id} Open\n## ${title}\nDescribe the problem, impact, and next steps.\n:::end ${id}`;
    editor.setRangeText(`${prefix}${block}${suffix}`, start, end, "end");
    const titleStart = start + prefix.length + `:::issue ${id} Open\n## `.length;
    editor.setSelectionRange(titleStart, titleStart + title.length);
    editor.focus();
    document.content = editor.value;
    document.updatedAt = new Date().toISOString();
    this.#scheduleSave();
    this.#renderIssuesPanel();
  }

  #toggleIssueState(documentId, issueId) {
    const document = this.documents.find((item) => item.id === documentId);
    if (!document) return;
    const pattern = /^:::issue ([a-zA-Z0-9_-]+) (Open|Completed)(?=\r?$)/gm;
    document.content = (document.content || "").replace(pattern, (line, id, status) => {
      if (id !== issueId) return line;
      return line.replace(status, status === "Open" ? "Completed" : "Open");
    });
    document.updatedAt = new Date().toISOString();
    this.#scheduleSave();
    this.#render();
  }

  #deleteIssue(documentId, issueId) {
    const document = this.documents.find((item) => item.id === documentId);
    if (!document || !window.confirm("Delete this problem from its work log? This cannot be undone.")) return;
    const pattern = /^:::issue ([a-zA-Z0-9_-]+) (Open|Completed)\r?\n[\s\S]*?\r?\n:::end \1[ \t]*(?:\r?\n)?/gm;
    let deleted = false;
    document.content = (document.content || "").replace(pattern, (block, id) => {
      if (id !== issueId) return block;
      deleted = true;
      return "";
    });
    if (!deleted) return;
    document.updatedAt = new Date().toISOString();
    this.#scheduleSave();
    this.#render();
  }

  async #cleanupUnusedAssets() {
    if (this.assetCleanupBusy) return;
    this.assetCleanupBusy = true;
    this.assetCleanupMessage = "Scanning assets…";
    const button = this.libraryRoot.querySelector(".worklog-cleanup-btn");
    const status = this.libraryRoot.querySelector(".worklog-cleanup-status");
    if (button) { button.disabled = true; button.textContent = "Scanning…"; }
    if (status) status.textContent = this.assetCleanupMessage;

    try {
      const previewResponse = await fetch("/api/worklog-assets/unused");
      const preview = await previewResponse.json();
      if (!previewResponse.ok || !preview.ok) throw new Error(preview.error || "Could not scan project assets.");
      if (preview.count === 0) {
        this.assetCleanupMessage = "No unused assets found.";
        return;
      }
      this.assetCleanupFiles = preview.files;
      this.assetCleanupSelected = new Set(preview.files);
      this.assetCleanupError = "";
      this.assetCleanupDialogOpen = true;
      this.#render();
    } catch (error) {
      this.assetCleanupMessage = error.message;
    } finally {
      this.assetCleanupBusy = false;
      const currentButton = this.libraryRoot.querySelector(".worklog-cleanup-btn");
      const currentStatus = this.libraryRoot.querySelector(".worklog-cleanup-status");
      if (currentButton) {
        currentButton.disabled = false;
        currentButton.textContent = "Clean unused assets";
      }
      if (currentStatus) currentStatus.textContent = this.assetCleanupMessage;
    }
  }

  #assetCleanupDialogHTML() {
    const allSelected = this.assetCleanupFiles.length > 0
      && this.assetCleanupSelected.size === this.assetCleanupFiles.length;
    return `<div class="worklog-cleanup-backdrop"><section class="worklog-cleanup-dialog" role="dialog" aria-modal="true" aria-labelledby="worklog-cleanup-title">
      <header><div><p>Asset cleanup</p><h3 id="worklog-cleanup-title">Unused files</h3></div><button data-action="close-cleanup-dialog" aria-label="Close cleanup dialog">&times;</button></header>
      <p class="worklog-cleanup-intro">Select files to permanently remove from <strong>assets/</strong>. Files referenced by any work log are excluded.</p>
      <label class="worklog-cleanup-select-all"><input type="checkbox" data-action="toggle-cleanup-all" ${allSelected ? "checked" : ""}><span>Select all <small>${this.assetCleanupFiles.length} files</small></span></label>
      <ul class="worklog-cleanup-files">${this.assetCleanupFiles.map((file) => `<li><label><input type="checkbox" data-action="toggle-cleanup-file" data-path="${this.#escapeAttr(file)}" ${this.assetCleanupSelected.has(file) ? "checked" : ""}><span title="${this.#escapeAttr(file)}">${this.#escape(file)}</span></label><button data-action="preview-cleanup-file" data-path="${this.#escapeAttr(file)}">Preview</button></li>`).join("")}</ul>
      ${this.assetCleanupError ? `<p class="worklog-cleanup-error" role="alert">${this.#escape(this.assetCleanupError)}</p>` : ""}
      <footer><span>${this.assetCleanupSelected.size} selected</span><div><button data-action="close-cleanup-dialog">Cancel</button><button class="worklog-cleanup-delete" data-action="delete-selected-assets" ${this.assetCleanupBusy || !this.assetCleanupSelected.size ? "disabled" : ""}>${this.assetCleanupBusy ? "Cleaning…" : `Delete selected (${this.assetCleanupSelected.size})`}</button></div></footer>
    </section></div>`;
  }

  #assetPreviewHTML() {
    const { path: filePath, loading, error, content, kind, truncated, size } = this.assetPreview;
    const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
    const extension = filePath.split(".").pop().toLowerCase();
    const isPdf = extension === "pdf";
    const imageTypes = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);
    const imageUrl = `/${encodedPath}`;
    const body = loading
      ? '<p class="worklog-asset-preview-message">Loading preview…</p>'
      : error
        ? `<p class="worklog-asset-preview-error" role="alert">${this.#escape(error)}</p>`
        : isPdf
          ? `<iframe class="worklog-asset-preview-frame" src="/api/worklog-pdf?path=${encodeURIComponent(filePath)}" title="${this.#escapeAttr(filePath)}"></iframe>`
          : imageTypes.has(extension)
            ? `<img class="worklog-asset-preview-image" src="${this.#escapeAttr(imageUrl)}" alt="${this.#escapeAttr(filePath)}">`
            : `<pre class="worklog-asset-preview-text">${this.#escape(content || "(empty file)")}${truncated ? "\n… preview truncated" : ""}</pre>`;
    return `<div class="worklog-cleanup-backdrop worklog-asset-preview-backdrop"><section class="worklog-asset-preview-dialog" role="dialog" aria-modal="true" aria-label="Asset preview">
      <header><div><p>${isPdf ? "PDF document" : kind === "binary" ? "Binary file · hex preview" : "File preview"}</p><h3>${this.#escape(filePath.split("/").pop())}</h3><small>${this.#escape(filePath)} · ${this.#formatAssetSize(size || 0)}</small></div><button data-action="close-asset-preview" aria-label="Close file preview">&times;</button></header>
      <div class="worklog-asset-preview-content">${body}</div>
    </section></div>`;
  }

  #formatAssetSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async #previewAsset(filePath) {
    this.assetPreview = { path: filePath, loading: true, error: "", content: "", kind: "", size: 0, truncated: false };
    this.#render();
    try {
      const response = await fetch(`/api/worklog-asset-preview?path=${encodeURIComponent(filePath)}`);
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not preview this file.");
      if (this.assetPreview?.path !== filePath) return;
      this.assetPreview = { ...result, loading: false, error: "" };
    } catch (error) {
      if (this.assetPreview?.path !== filePath) return;
      this.assetPreview = { path: filePath, loading: false, error: error.message, content: "", size: 0, truncated: false };
    }
    this.#render();
  }

  async #deleteSelectedAssets() {
    const files = [...this.assetCleanupSelected];
    if (!files.length || this.assetCleanupBusy) return;
    if (!window.confirm(`Permanently delete ${files.length} selected file${files.length === 1 ? "" : "s"}?`)) return;
    this.assetCleanupBusy = true;
    this.assetCleanupError = "";
    this.#render();
    try {
      const response = await fetch("/api/worklog-assets/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Could not clean project assets.");
      this.assetCleanupMessage = result.failed.length
        ? `Deleted ${result.count}; failed ${result.failed.length}.`
        : result.skipped.length
          ? `Deleted ${result.count}; skipped ${result.skipped.length} now-referenced file${result.skipped.length === 1 ? "" : "s"}.`
          : `Deleted ${result.count} file${result.count === 1 ? "" : "s"}.`;
      this.assetCleanupFiles = this.assetCleanupFiles.filter((file) => !result.deleted.includes(file));
      this.assetCleanupSelected = new Set(this.assetCleanupFiles);
      if (!this.assetCleanupFiles.length) this.assetCleanupDialogOpen = false;
    } catch (error) {
      this.assetCleanupError = error.message;
    } finally {
      this.assetCleanupBusy = false;
      this.#render();
    }
  }

  #documentList(documents, emptyText) {
    if (!documents.length) return `<p class="worklog-library-empty">${emptyText}</p>`;
    return documents.map((document) => `<button class="worklog-document-item ${document.id === this.selectedId ? "active" : ""} ${this.selection.has(document.id) ? "multi-selected" : ""}" data-action="select" data-id="${document.id}" aria-selected="${this.selection.has(document.id)}"><span>${this.#escape(document.title || "Untitled work log")}</span>${document.id === this.selectedId ? '<em>Open</em>' : ""}<small>${this.#relativeDate(document.updatedAt)}</small></button>`).join("");
  }

  #contextMenuHTML() {
    const { x, y } = this.contextMenu;
    const label = this.selection.size > 1 ? `Delete selected (${this.selection.size})` : "Delete";
    return `<div class="worklog-context-menu" style="left:${x}px; top:${y}px;" role="menu">
      <button data-action="export-pdf" role="menuitem">Export PDF</button>
      <button class="worklog-context-delete" data-action="delete-selected" role="menuitem">${label}</button>
    </div>`;
  }

  #editorHTML(document) {
    return `
      <div class="worklog-document-context"><span class="worklog-open-marker" aria-hidden="true"></span><span>Editor</span><strong>${this.#escape(document.title || "Untitled work log")}</strong></div>
      <div class="worklog-document-header">
        <input class="worklog-document-title" aria-label="Work log topic" value="${this.#escapeAttr(document.title)}" placeholder="Log topic">
        <div class="worklog-document-actions">
            <button class="worklog-issues-toggle" data-action="toggle-issues" aria-expanded="${this.issuesPanelOpen}">Issues <span>${this.#allIssues().length}</span></button>
          <button class="worklog-export-pdf-btn" data-action="export-pdf">Export PDF</button>
          <div class="worklog-tabs" role="tablist" aria-label="Work log mode">
            <button class="worklog-tab ${this.mode === "edit" ? "active" : ""}" data-action="mode" data-mode="edit" role="tab" aria-selected="${this.mode === "edit"}">Edit</button>
            <button class="worklog-tab ${this.mode === "preview" ? "active" : ""}" data-action="mode" data-mode="preview" role="tab" aria-selected="${this.mode === "preview"}">Preview</button>
          </div>
        </div>
      </div>
      <p class="worklog-document-meta">Updated ${new Date(document.updatedAt).toLocaleString()} <span class="worklog-image-status">${this.#escape(this.imageStatus)}</span></p>
      <div class="worklog-toolbar" aria-label="Markdown formatting">
        <button data-action="format" data-format="heading" title="Heading">H</button>
        <button data-action="format" data-format="bold" title="Bold"><strong>B</strong></button>
        <button data-action="format" data-format="italic" title="Italic"><em>I</em></button>
        <button data-action="format" data-format="list" title="Bulleted list">List</button>
        <button data-action="format" data-format="ordered" title="Numbered list">1.</button>
        <button data-action="resource-link" title="Insert URL or local text file">Link</button>
        <button data-action="task-reference" title="Insert task reference">Task</button>
        <button data-action="image" title="Paste image from clipboard">Image</button>
        <button data-action="insert-issue" title="Insert a problem block">Issue</button>
        <button data-action="format" data-format="code" title="Code block">Code</button>
      </div>
      <div class="worklog-body">
        <textarea class="worklog-editor ${this.mode === "edit" ? "visible" : ""}" aria-label="Work log Markdown editor" placeholder="# Progress&#10;&#10;Record progress, decisions, and next steps in Markdown.">${this.#escape(document.content)}</textarea>
        <article class="worklog-preview ${this.mode === "preview" ? "visible" : ""}">${document.content ? this.#toMarkdown(document.content) : '<p class="worklog-empty">No entries yet.</p>'}</article>
        <div class="worklog-page-markers" aria-hidden="true"></div>
      </div>`;
  }

  #emptyHTML() {
    return `<div class="worklog-empty-state"><h3>Select or create a work log</h3><p>Keep one document open for each project, topic, or ongoing thread.</p><button class="worklog-new-btn" data-action="new">Create log</button><button class="worklog-issues-toggle" data-action="toggle-issues" aria-expanded="${this.issuesPanelOpen}">Issues <span>${this.#allIssues().length}</span></button></div>`;
  }

  #bindEvents() {
    if (!this.root || !this.libraryRoot) return;
    this.pageMarkerObserver = new ResizeObserver(() => this.#renderPageMarkers());
    this.#observePageMarkerSurfaces();
    this.#renderPageMarkers();
    const handleClick = (event) => {
      const control = event.target.closest("[data-action]");
      if (!control) return;
      const { action } = control.dataset;
      if (action === "new") this.#createDocument();
      if (action === "cleanup-assets") this.#cleanupUnusedAssets();
      if (action === "close-cleanup-dialog") {
        this.assetCleanupDialogOpen = false;
        this.assetCleanupError = "";
        this.#render();
      }
      if (action === "delete-selected-assets") this.#deleteSelectedAssets();
      if (action === "preview-cleanup-file") this.#previewAsset(control.dataset.path);
      if (action === "close-asset-preview") { this.assetPreview = null; this.#render(); }
      if (action === "select") this.#selectDocument(Number(control.dataset.id), event);
      if (action === "delete-selected") this.#deleteDocuments([...this.selection]);
      if (action === "mode") {
        const currentSurface = this.root.querySelector(".worklog-editor.visible, .worklog-preview.visible");
        const scrollTop = currentSurface?.scrollTop || 0;
        this.mode = control.dataset.mode;
        this.#render();
        requestAnimationFrame(() => {
          const editor = this.root.querySelector(".worklog-editor");
          const preview = this.root.querySelector(".worklog-preview");
          if (editor) editor.scrollTop = scrollTop;
          if (preview) preview.scrollTop = scrollTop;
          this.#renderPageMarkers();
        });
      }
      if (action === "toggle-issues") {
        this.issuesPanelOpen = !this.issuesPanelOpen;
        this.#renderIssuesPanel();
      }
      if (action === "insert-issue") this.#insertIssueBlock();
      if (action === "toggle-issue-state") this.#toggleIssueState(Number(control.dataset.documentId), control.dataset.issueId);
      if (action === "delete-issue") this.#deleteIssue(Number(control.dataset.documentId), control.dataset.issueId);
      if (action === "open-issue-log") {
        this.selectedId = Number(control.dataset.documentId);
        this.selection = new Set([this.selectedId]);
        this.selectionAnchorId = this.selectedId;
        this.mode = "edit";
        this.#render();
        requestAnimationFrame(() => {
          const editor = this.root.querySelector(".worklog-editor");
          const marker = `:::issue ${control.dataset.issueId}`;
          const markerStart = editor?.value.indexOf(marker) ?? -1;
          if (!editor || markerStart < 0) return;
          const contentStart = editor.value.indexOf("\n", markerStart) + 1;
          editor.focus();
          editor.setSelectionRange(contentStart, contentStart);
        });
      }
      if (action === "format") this.#applyFormat(control.dataset.format);
      if (action === "task-reference") this.#openReferencePicker();
      if (action === "resource-link") this.#openResourceDialog();
      if (action === "resource-mode") { this.resourceMode = control.dataset.mode; this.#render(); }
      if (action === "insert-resource") this.#insertResource();
      if (action === "close-resource-dialog") {
        this.resourceDialogOpen = false;
        this.resourceCopyOnInsert = false;
        this.resourceCopying = false;
        this.#render();
      }
      if (action === "show-resource-preview") this.#openResourcePreview(control.dataset);
      if (action === "close-resource-preview") { this.resourcePreview = null; this.#render(); }
      if (action === "copy-resource-to-project") this.#copyResourceToProject();
      if (action === "resource-zoom-in") this.#changeResourceZoom(0.1);
      if (action === "resource-zoom-out") this.#changeResourceZoom(-0.1);
      if (action === "resource-zoom-reset") this.#changeResourceZoom(0);
      if (action === "insert-task-reference") this.#insertTaskReference(control.dataset);
      if (action === "toggle-reference-tree") this.#toggleReferenceTree(Number(control.dataset.id));
      if (action === "close-reference-picker") { this.referencePickerOpen = false; this.#render(); }
      if (action === "show-task-reference") this.#openReferencePreview(control.dataset);
      if (action === "close-reference-card") { this.referencePreview = null; this.#render(); }
      if (action === "image") this.#pasteImageFromClipboard();
      if (action === "export-pdf") this.#exportPdf();
    };
    this.root.addEventListener("click", handleClick);
    this.libraryRoot.addEventListener("click", handleClick);
    this.issuesRoot?.addEventListener("click", handleClick);
    this.root.addEventListener("change", (event) => {
      if (event.target.matches('[data-action="toggle-cleanup-all"]')) {
        this.assetCleanupSelected = event.target.checked ? new Set(this.assetCleanupFiles) : new Set();
        this.#render();
      }
      if (event.target.matches('[data-action="toggle-cleanup-file"]')) {
        const file = event.target.dataset.path;
        if (event.target.checked) this.assetCleanupSelected.add(file);
        else this.assetCleanupSelected.delete(file);
        this.#render();
      }
    });
    this.issuesRoot?.addEventListener("change", (event) => {
      if (event.target.matches('[data-issue-filter="document"]')) {
        const id = Number(event.target.dataset.documentId);
        if (event.target.checked) this.issueDocumentSelection.add(id);
        else this.issueDocumentSelection.delete(id);
      }
      if (event.target.matches('[data-issue-filter="status"]')) {
        const status = event.target.dataset.status;
        if (event.target.checked) this.issueStatusSelection.add(status);
        else this.issueStatusSelection.delete(status);
      }
      this.#renderIssuesPanel();
    });
    window.addEventListener("resize", () => {
      this.#renderPageMarkers();
      this.#positionIssuesPanel();
      this.#scheduleRelationshipRender();
    });
    window.addEventListener("scroll", () => {
      this.#positionIssuesPanel();
      this.#scheduleRelationshipRender();
    }, { passive: true });
    document.addEventListener("scroll", () => {
      this.#positionIssuesPanel();
      this.#scheduleRelationshipRender();
    }, { capture: true, passive: true });
    this.relationshipObserver = new ResizeObserver(() => this.#scheduleRelationshipRender());
    const dayEditor = document.getElementById("day-editor-section");
    if (dayEditor) this.relationshipObserver.observe(dayEditor);
    if (this.root) this.relationshipObserver.observe(this.root);
    this.libraryRoot.addEventListener("contextmenu", (event) => {
      const item = event.target.closest(".worklog-document-item");
      if (!item) return;
      event.preventDefault();
      const id = Number(item.dataset.id);
      if (!this.selection.has(id)) {
        this.selection = new Set([id]);
        this.selectionAnchorId = id;
      }
      this.selectedId = id;
      this.contextMenu = { x: event.clientX, y: event.clientY };
      this.#render();
    });
    this.root.addEventListener("input", (event) => {
      if (event.target.matches(".worklog-image-width")) {
        const width = Math.max(10, Math.min(100, Number(event.target.value) || 100));
        const image = event.target.closest(".worklog-image")?.querySelector("img");
        const output = event.target.parentElement.querySelector("output");
        if (image) image.style.width = `${width}%`;
        if (output) output.value = `${width}%`;
        const document = this.#selectedDocument();
        if (document) {
          document.content = this.#setMarkdownImageWidth(document.content, Number(event.target.dataset.imageIndex), width);
          document.updatedAt = new Date().toISOString();
          this.#scheduleSave();
          this.#schedulePageMarkerRefresh();
        }
        return;
      }
      if (event.target.matches(".worklog-resource-input")) {
        this[event.target.dataset.resourceField] = event.target.value;
        return;
      }
      if (event.target.matches(".worklog-reference-search")) {
        const globalQueryChanged = event.target.dataset.referenceFilter === "global"
          && this.referenceGlobalQuery !== event.target.value;
        if (event.target.dataset.referenceFilter === "global") this.referenceGlobalQuery = event.target.value;
        if (event.target.dataset.referenceFilter === "calendar") this.referenceCalendarQuery = event.target.value;
        this.#filterReferencePicker(globalQueryChanged);
        return;
      }
      const document = this.#selectedDocument();
      if (!document) return;
      if (event.target.matches(".worklog-document-title")) {
        document.title = event.target.value;
        this.#syncOpenDocumentTitle(document.title);
      }
      if (event.target.matches(".worklog-editor")) document.content = event.target.value;
      if (event.target.matches(".worklog-document-title, .worklog-editor")) {
        document.updatedAt = new Date().toISOString();
        this.#scheduleSave();
      }
      if (event.target.matches(".worklog-editor")) this.#schedulePageMarkerRefresh();
    });
    this.root.addEventListener("change", (event) => {
      if (event.target.matches(".worklog-resource-copy-checkbox")) {
        this.resourceCopyOnInsert = event.target.checked;
      }
    });
    this.root.addEventListener("scroll", (event) => {
      if (event.target.matches?.(".worklog-editor, .worklog-preview.visible")) this.#renderPageMarkers();
    }, true);
    this.root.addEventListener("load", (event) => {
      if (event.target.matches?.(".worklog-preview img")) this.#renderPageMarkers();
    }, true);
    this.root.addEventListener("toggle", (event) => {
      if (!event.target.matches?.(".worklog-preview details.worklog-image")) return;
      this.expandedImages.set(`${this.selectedId}:${event.target.dataset.imagePath}`, event.target.open);
      requestAnimationFrame(() => this.#renderPageMarkers());
    }, true);
    this.root.addEventListener("paste", (event) => {
      if (!event.target.matches(".worklog-editor")) return;
      const imageItem = [...event.clipboardData.items].find((item) => item.type.startsWith("image/"));
      const file = imageItem?.getAsFile();
      if (!file) return;
      event.preventDefault();
      this.#insertClipboardImage(file, event.target);
    });
    document.addEventListener("mousedown", (event) => {
      if (!this.contextMenu || event.target.closest?.(".worklog-context-menu")) return;
      this.#dismissContextMenu();
    });
  }

  #dismissContextMenu() {
    this.contextMenu = null;
    this.root.querySelector(".worklog-context-menu")?.remove();
  }

  #syncOpenDocumentTitle(title) {
    const label = title || "Untitled work log";
    this.libraryRoot?.querySelector(".worklog-document-item.active span")?.replaceChildren(label);
    this.libraryRoot?.querySelector(".worklog-open-summary strong")?.replaceChildren(label);
    this.root?.querySelector(".worklog-document-context strong")?.replaceChildren(label);
  }

  #openResourceDialog() {
    const editor = this.root.querySelector(".worklog-editor");
    this.resourceSelection = editor ? { start: editor.selectionStart, end: editor.selectionEnd } : null;
    this.resourceError = "";
    this.resourceDialogOpen = true;
    this.#render();
  }

  #resourceDialogHTML() {
    const isUrl = this.resourceMode === "url";
    return `<div class="worklog-resource-backdrop"><section class="worklog-resource-dialog" role="dialog" aria-modal="true" aria-label="Insert URL or local text file">
      <div class="worklog-reference-picker-header"><div><p>Insert reference</p><h3>Link or file</h3></div><button data-action="close-resource-dialog" aria-label="Close">&times;</button></div>
      <div class="worklog-resource-modes" role="tablist" aria-label="Reference type"><button class="worklog-tab ${isUrl ? "active" : ""}" data-action="resource-mode" data-mode="url" role="tab" aria-selected="${isUrl}">URL</button><button class="worklog-tab ${!isUrl ? "active" : ""}" data-action="resource-mode" data-mode="file" role="tab" aria-selected="${!isUrl}">Local file</button></div>
      <label class="worklog-resource-field"><span>${isUrl ? "Web address" : "File path"}</span><input class="worklog-resource-input" data-resource-field="${isUrl ? "resourceUrl" : "resourcePath"}" type="${isUrl ? "url" : "text"}" value="${this.#escapeAttr(isUrl ? this.resourceUrl : this.resourcePath)}" placeholder="${isUrl ? "https://example.com" : "D:/folder/document.pdf or ./notes.txt"}" autocomplete="off"></label>
      ${!isUrl ? `<label class="worklog-resource-copy-option"><input type="checkbox" class="worklog-resource-copy-checkbox" ${this.resourceCopyOnInsert ? "checked" : ""} ${this.resourceCopying ? "disabled" : ""}><span><strong>Copy file into project and replace reference</strong><small>Copies to assets/worklog-files/</small></span></label>` : ""}
      <label class="worklog-resource-field"><span>Display name</span><input class="worklog-resource-input" data-resource-field="resourceLabel" type="text" value="${this.#escapeAttr(this.resourceLabel)}" placeholder="Optional"></label>
      ${this.resourceError ? `<p class="worklog-resource-error" role="alert">${this.#escape(this.resourceError)}</p>` : ""}
      <div class="worklog-resource-actions"><button data-action="close-resource-dialog" ${this.resourceCopying ? "disabled" : ""}>Cancel</button><button class="worklog-resource-insert" data-action="insert-resource" ${this.resourceCopying ? "disabled" : ""}>${this.resourceCopying ? "Copying…" : "Insert"}</button></div>
    </section></div>`;
  }

  async #insertResource() {
    const document = this.#selectedDocument();
    if (!document) return;
    let target;
    let label = this.resourceLabel.trim();
    if (this.resourceMode === "url") {
      try {
        const url = new URL(this.resourceUrl.trim());
        if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error();
        target = url.href;
        if (!label) label = url.hostname;
      } catch {
        this.resourceError = "Enter a valid HTTP or HTTPS URL.";
        this.#render();
        return;
      }
    } else {
      const filePath = this.resourcePath.trim().replace(/\\/g, "/");
      if (!filePath || filePath.includes("\0")) {
        this.resourceError = "Enter an absolute or relative file path.";
        this.#render();
        return;
      }
      target = filePath;
      if (!label) label = target.split("/").pop();
      if (this.resourceCopyOnInsert) {
        this.resourceCopying = true;
        this.resourceError = "";
        this.#render();
        try {
          const response = await fetch("/api/copy-worklog-text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: target }),
          });
          const result = await response.json();
          if (!response.ok || !result.path) throw new Error(result.error || "Could not copy this file.");
          target = result.path;
        } catch (error) {
          this.resourceCopying = false;
          this.resourceError = error.message;
          this.#render();
          return;
        }
      }
    }
    label = label.replace(/[\[\]|\r\n]/g, " ").trim() || "Open reference";
    const reference = `[[resource:${this.resourceMode}:${encodeURIComponent(target)}|${label}]]`;
    const selection = this.resourceSelection || { start: document.content.length, end: document.content.length };
    document.content = `${document.content.slice(0, selection.start)}${reference}${document.content.slice(selection.end)}`;
    document.updatedAt = new Date().toISOString();
    this.resourceDialogOpen = false;
    this.resourceSelection = null;
    this.resourceUrl = "";
    this.resourcePath = "";
    this.resourceLabel = "";
    this.resourceError = "";
    this.resourceCopyOnInsert = false;
    this.resourceCopying = false;
    this.#persist();
    this.#render();
    requestAnimationFrame(() => {
      const editor = this.root.querySelector(".worklog-editor");
      if (!editor) return;
      const cursor = selection.start + reference.length;
      editor.focus();
      editor.setSelectionRange(cursor, cursor);
    });
  }

  #openResourcePreview({ kind, target, label }) {
    const referenceTarget = target;
    try { target = decodeURIComponent(target); } catch { /* Keep malformed legacy references readable. */ }
    if (kind === "url") {
      try {
        const url = new URL(target);
        if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error();
        target = url.href;
      } catch {
        this.resourcePreview = { kind, target, label, content: "", loading: false, error: "This URL is not allowed." };
        this.#render();
        return;
      }
    }
    const isPdf = kind === "file" && /\.pdf$/i.test(target);
    const normalizedTarget = target.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
    const isProjectCopy = kind === "file"
      && (normalizedTarget.startsWith("assets/worklog-files/") || normalizedTarget.includes("/assets/worklog-files/"));
    this.resourceZoom = 1;
    this.resourcePreview = { kind, target, referenceTarget, label, content: "", isPdf, loading: kind === "file" && !isPdf, error: "", copying: false, copied: isProjectCopy, copyJustDone: false, copyError: "" };
    this.#render();
    if (kind !== "file" || isPdf) return;
    fetch(`/api/worklog-text?path=${encodeURIComponent(target)}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load text file.");
        return result;
      })
      .then((result) => {
        if (this.resourcePreview?.target !== target) return;
        this.resourcePreview = { ...this.resourcePreview, content: result.content, loading: false };
        this.#render();
      })
      .catch((error) => {
        if (this.resourcePreview?.target !== target) return;
        this.resourcePreview = { ...this.resourcePreview, loading: false, error: error.message };
        this.#render();
      });
  }

  #resourcePreviewHTML() {
    const { kind, target, label, content, isPdf, loading, error } = this.resourcePreview;
    const isWebPage = kind === "url";
    const frameSource = isPdf ? `/api/worklog-pdf?path=${encodeURIComponent(target)}` : target;
    const frameUrl = isPdf ? `${frameSource}#zoom=${Math.round(this.resourceZoom * 100)}` : frameSource;
    const frame = `<div class="worklog-resource-frame-viewport${isPdf ? " is-pdf" : ""}" style="--resource-zoom:${this.resourceZoom}"><iframe class="worklog-resource-frame" src="${this.#escapeAttr(frameUrl)}" ${isPdf ? `data-pdf-source="${this.#escapeAttr(frameSource)}"` : ""} title="${this.#escapeAttr(label)}" ${isWebPage ? 'sandbox="allow-scripts allow-forms allow-popups" referrerpolicy="no-referrer"' : ""}></iframe></div><a class="worklog-resource-open-link" href="${this.#escapeAttr(frameUrl)}" target="_blank" rel="noopener noreferrer">Open in browser</a>`;
    const body = isWebPage || isPdf
      ? error ? `<p class="worklog-resource-error" role="alert">${this.#escape(error)}</p>` : frame
      : loading
        ? '<p class="worklog-resource-loading">Loading text file…</p>'
        : error
          ? `<p class="worklog-resource-error" role="alert">${this.#escape(error)}</p>`
          : `<pre class="worklog-resource-text" style="--resource-zoom:${this.resourceZoom}">${this.#escape(content)}</pre>`;
    return `<div class="worklog-resource-backdrop"><section class="worklog-resource-preview" role="dialog" aria-modal="true" aria-label="${this.#escapeAttr(label)}">
      <header><div class="worklog-resource-preview-heading"><p>${isWebPage ? "Web page" : isPdf ? "PDF document" : "Local text file"}</p><h3>${this.#escape(label)}</h3><small>${this.#escape(target)}</small></div><div class="worklog-resource-preview-controls" aria-label="Preview zoom"><button data-action="resource-zoom-out" title="Zoom out" aria-label="Zoom out">&minus;</button><output>${Math.round(this.resourceZoom * 100)}%</output><button data-action="resource-zoom-in" title="Zoom in" aria-label="Zoom in">+</button><button data-action="resource-zoom-reset" title="Reset zoom" aria-label="Reset zoom">Reset</button></div><button data-action="close-resource-preview" aria-label="Close preview">&times;</button></header>
      <div class="worklog-resource-preview-body">${body}</div>
      ${kind === "file" ? `<footer class="worklog-resource-copy-footer">${this.resourcePreview.copyError ? `<p role="alert">${this.#escape(this.resourcePreview.copyError)}</p>` : this.resourcePreview.copied ? `<p>${this.resourcePreview.copyJustDone ? "Copied into the project and reference updated." : "Already stored in the project."}</p>` : "<span>Keep a project copy in assets/worklog-files</span>"}${this.resourcePreview.copied ? "" : `<button data-action="copy-resource-to-project" ${loading || this.resourcePreview.copying ? "disabled" : ""}>${this.resourcePreview.copying ? "Copying…" : "Copy into project"}</button>`}</footer>` : ""}
    </section></div>`;
  }

  async #copyResourceToProject() {
    const preview = this.resourcePreview;
    if (!preview || preview.kind !== "file" || preview.copying || preview.copied) return;
    this.resourcePreview = { ...preview, copying: true, copyError: "" };
    this.#render();
    try {
      const response = await fetch("/api/copy-worklog-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: preview.target }),
      });
      const result = await response.json();
      if (!response.ok || !result.path) throw new Error(result.error || "Could not copy this file.");

      const document = this.#selectedDocument();
      if (!document) throw new Error("The open work log is no longer available.");
      const oldReference = `[[resource:file:${preview.referenceTarget}|${preview.label}]]`;
      const newReferenceTarget = encodeURIComponent(result.path);
      const newReference = `[[resource:file:${newReferenceTarget}|${preview.label}]]`;
      if (!document.content.includes(oldReference)) throw new Error("Could not find the original file reference in this log.");
      document.content = document.content.split(oldReference).join(newReference);
      document.updatedAt = new Date().toISOString();
      this.#persist();
      this.resourcePreview = {
        ...preview,
        target: result.path,
        referenceTarget: newReferenceTarget,
        copying: false,
        copied: true,
        copyJustDone: true,
        copyError: "",
      };
      this.#render();
    } catch (error) {
      if (!this.resourcePreview) return;
      this.resourcePreview = { ...this.resourcePreview, copying: false, copyError: error.message };
      this.#render();
    }
  }

  #changeResourceZoom(delta) {
    this.resourceZoom = delta === 0
      ? 1
      : Math.max(0.5, Math.min(2, Math.round((this.resourceZoom + delta) * 10) / 10));
    const preview = this.root.querySelector(".worklog-resource-preview");
    preview?.querySelector("output")?.replaceChildren(`${Math.round(this.resourceZoom * 100)}%`);
    const viewport = preview?.querySelector(".worklog-resource-frame-viewport");
    if (viewport) viewport.style.setProperty("--resource-zoom", this.resourceZoom);
    if (viewport?.classList.contains("is-pdf")) {
      const frame = viewport.querySelector(".worklog-resource-frame");
      if (frame?.dataset.pdfSource) frame.src = `${frame.dataset.pdfSource}#zoom=${Math.round(this.resourceZoom * 100)}`;
      return;
    }
    const text = preview?.querySelector(".worklog-resource-text");
    if (text) text.style.setProperty("--resource-zoom", this.resourceZoom);
  }

  #openReferencePicker() {
    const editor = this.root.querySelector(".worklog-editor");
    this.editorSelection = editor ? { start: editor.selectionStart, end: editor.selectionEnd } : null;
    this.referencePreview = null;
    this.referenceTreeExpanded = new Set(this.#branchIds(LongTermStorage.loadAll()));
    this.referencePickerOpen = true;
    this.#render();
  }

  #referencePickerHTML() {
    const calendarTasks = Object.entries(CalendarStorage.loadAll())
      .flatMap(([date, tasks]) => tasks.filter((task) => !task.longtermId).map((task) => ({ ...task, date })))
      .sort((left, right) => right.date.localeCompare(left.date));
    const longTermTasks = LongTermStorage.loadAll();
    return `<div class="worklog-reference-backdrop"><section class="worklog-reference-picker" role="dialog" aria-modal="true" aria-label="Insert task reference">
      <div class="worklog-reference-picker-header"><div><p>Insert reference</p><h3>Tasks</h3></div><button data-action="close-reference-picker" aria-label="Close task picker" title="Close">&times;</button></div>
      <input class="worklog-reference-search" data-reference-filter="global" type="search" value="${this.#escapeAttr(this.referenceGlobalQuery)}" placeholder="Search all tasks" aria-label="Search all tasks" autocomplete="off">
      <div class="worklog-reference-picker-body">
        <section class="worklog-reference-column"><div class="worklog-reference-column-header"><h4>Scheduled tasks</h4><input class="worklog-reference-search" data-reference-filter="calendar" type="search" value="${this.#escapeAttr(this.referenceCalendarQuery)}" placeholder="Search scheduled tasks" aria-label="Search scheduled tasks" autocomplete="off"></div><div class="worklog-reference-options">${calendarTasks.length ? calendarTasks.map((task) => `<button class="worklog-reference-option" data-action="insert-task-reference" data-kind="calendar" data-date="${task.date}" data-id="${task.id}" data-label="${this.#escapeAttr(task.abstract)}" data-search="${this.#escapeAttr(`${task.abstract} ${task.date}`)}"><span>${this.#escape(task.abstract)}</span><small>${task.date}</small></button>`).join("") : '<p class="worklog-reference-empty">No scheduled tasks.</p>'}</div></section>
        <section class="worklog-reference-column"><div class="worklog-reference-column-header"><h4>Long-term tasks</h4><span>Task tree</span></div><div class="worklog-reference-tree">${longTermTasks.length ? this.#longTermReferenceTreeHTML(longTermTasks) : '<p class="worklog-reference-empty">No long-term tasks.</p>'}</div></section>
      </div>
    </section></div>`;
  }

  #longTermReferenceTreeHTML(nodes, depth = 0, ancestors = []) {
    return nodes.map((node) => {
      const label = node.abstract || "Untitled";
      const hasChildren = node.children?.length > 0;
      const isExpanded = this.referenceTreeExpanded.has(node.id);
      const searchText = this.#longTermSearchText(node, ancestors);
      return `<div class="worklog-reference-tree-branch">
        <div class="worklog-reference-tree-node" data-id="${node.id}" data-depth="${depth}" data-search="${this.#escapeAttr(searchText)}">
          ${hasChildren ? `<button class="worklog-reference-tree-toggle ${isExpanded ? "expanded" : ""}" data-action="toggle-reference-tree" data-id="${node.id}" title="${isExpanded ? "Collapse" : "Expand"}">⌄</button>` : '<span class="worklog-reference-tree-toggle" aria-hidden="true"></span>'}<span class="lt-priority" data-priority="${node.priority || "none"}"></span>
          ${hasChildren
            ? `<span class="worklog-reference-tree-parent"><span>${this.#escape(label)}</span><small>Group</small></span>`
            : `<button data-action="insert-task-reference" data-kind="longterm" data-id="${node.id}" data-label="${this.#escapeAttr(label)}"><span>${this.#escape(label)}</span><small>${node.scheduledDate || "Not scheduled"}</small></button>`}
        </div>${hasChildren ? `<div class="worklog-reference-tree-children${isExpanded ? "" : " collapsed"}">${this.#longTermReferenceTreeHTML(node.children, depth + 1, [...ancestors, label])}</div>` : ""}
      </div>`;
    }).join("");
  }

  #longTermSearchText(node, ancestors) {
    const names = [node.abstract || "Untitled"];
    const collect = (children) => children.forEach((child) => {
      names.push(child.abstract || "Untitled");
      collect(child.children || []);
    });
    collect(node.children || []);
    return [...ancestors, ...names].join(" ");
  }

  #branchIds(nodes) {
    return nodes.flatMap((node) => node.children?.length ? [node.id, ...this.#branchIds(node.children)] : []);
  }

  #toggleReferenceTree(id) {
    if (this.referenceTreeExpanded.has(id)) this.referenceTreeExpanded.delete(id);
    else this.referenceTreeExpanded.add(id);
    this.#render();
  }

  #filterReferencePicker(expandMatchingBranches = false) {
    const globalQuery = this.referenceGlobalQuery.trim().toLocaleLowerCase();
    const calendarQuery = this.referenceCalendarQuery.trim().toLocaleLowerCase();
    this.root.querySelectorAll(".worklog-reference-option").forEach((option) => {
      const text = option.dataset.search.toLocaleLowerCase();
      option.hidden = !text.includes(globalQuery) || !text.includes(calendarQuery);
    });
    const treeNodes = [...this.root.querySelectorAll(".worklog-reference-tree-node")];
    treeNodes.forEach((node) => {
      node.hidden = !node.dataset.search.toLocaleLowerCase().includes(globalQuery);
    });
    if (globalQuery && expandMatchingBranches) {
      treeNodes.filter((node) => !node.hidden).forEach((node) => {
        let branch = node.closest(".worklog-reference-tree-branch");
        while (branch) {
          const children = branch.querySelector(":scope > .worklog-reference-tree-children");
          if (children) {
            children.classList.remove("collapsed");
            const parentNode = branch.querySelector(":scope > .worklog-reference-tree-node");
            const toggle = parentNode?.querySelector(".worklog-reference-tree-toggle");
            toggle?.classList.add("expanded");
            toggle?.setAttribute("title", "Collapse");
            if (parentNode?.dataset.id) this.referenceTreeExpanded.add(Number(parentNode.dataset.id));
          }
          branch = branch.parentElement.closest(".worklog-reference-tree-branch");
        }
      });
    }
  }

  #insertTaskReference({ kind, date, id, label }) {
    const document = this.#selectedDocument();
    if (!document || !kind || !id) return;
    const reference = kind === "calendar"
      ? `[[task:calendar:${date}:${id}|${label}]]`
      : `[[task:longterm:${id}|${label}]]`;
    const selection = this.editorSelection || { start: document.content.length, end: document.content.length };
    document.content = `${document.content.slice(0, selection.start)}${reference}${document.content.slice(selection.end)}`;
    document.updatedAt = new Date().toISOString();
    this.referencePickerOpen = false;
    this.editorSelection = null;
    this.referenceGlobalQuery = "";
    this.referenceCalendarQuery = "";
    this.#persist();
    this.#render();
    requestAnimationFrame(() => {
      const editor = this.root.querySelector(".worklog-editor");
      if (!editor) return;
      const cursor = selection.start + reference.length;
      editor.focus();
      editor.setSelectionRange(cursor, cursor);
    });
  }

  #openReferencePreview({ kind, date, id }) {
    this.referencePickerOpen = false;
    this.referencePreview = { kind, date, id: Number(id) };
    if (kind === "longterm") window.__ds?.lt?.focusTask(Number(id));
    this.#render();
  }

  #referenceCardHTML() {
    const reference = this.referencePreview;
    const task = reference.kind === "calendar"
      ? CalendarStorage.getTasks(reference.date).find((item) => item.id === reference.id)
      : LongTermStorage.findNode(LongTermStorage.loadAll(), reference.id);
    if (!task) return `<div class="worklog-reference-backdrop"><section class="worklog-reference-card"><button data-action="close-reference-card" aria-label="Close task details">&times;</button><p class="worklog-reference-empty">This task is no longer available.</p></section></div>`;
    const date = reference.kind === "calendar" ? reference.date : task.scheduledDate;
    const dateTasks = date ? CalendarStorage.getTasks(date) : [];
    const scheduledTask = reference.kind === "longterm"
      ? dateTasks.find((item) => item.longtermId === task.id)
      : null;
    const status = reference.kind === "calendar"
      ? (task.completed ? "Completed" : "Open")
      : scheduledTask
        ? (scheduledTask.completed ? "Completed" : "Open")
        : "Not scheduled";
    const type = reference.kind === "calendar" ? "Scheduled task" : "Long-term task";
    return `<div class="worklog-reference-backdrop"><section class="worklog-reference-card" role="dialog" aria-modal="true" aria-label="Task details">
      <button class="worklog-reference-close" data-action="close-reference-card" aria-label="Close task details">&times;</button>
      <p class="worklog-reference-card-type">${type}</p><h3>${this.#escape(task.abstract || "Untitled")}</h3>
      ${task.description ? `<p class="worklog-reference-description">${this.#escape(task.description)}</p>` : ""}
      <dl><div><dt>Priority</dt><dd>${this.#escape(task.priority || "none")}</dd></div><div><dt>Status</dt><dd>${status}</dd></div>${date ? `<div><dt>Scheduled</dt><dd>${date}</dd></div>` : ""}</dl>
      <div class="worklog-reference-date-tasks"><h4>${date ? `Tasks on ${date}` : "No scheduled date"}</h4>${date ? `<ul>${dateTasks.map((item) => { const referenced = reference.kind === "calendar" ? item.id === reference.id : item.longtermId === reference.id; return `<li class="${referenced ? "referenced" : ""}">${this.#escape(item.abstract)}</li>`; }).join("") || "<li>No tasks scheduled.</li>"}</ul>` : `<p>The task has not been scheduled yet.</p>`}</div>
    </section></div>`;
  }

  #scheduleRelationshipRender() {
    cancelAnimationFrame(this.relationshipFrame);
    this.relationshipFrame = requestAnimationFrame(() => this.#renderRelationship());
  }

  #renderRelationship() {
    const path = document.querySelector("#worklog-relationship path");
    const endpoint = document.querySelector("#worklog-relationship circle");
    const source = this.libraryRoot?.querySelector(".worklog-document-item.active");
    const target = this.root?.querySelector(".worklog-document");
    if (!path || !source || !target || window.innerWidth <= 900) {
      if (path) path.setAttribute("d", "");
      if (endpoint) endpoint.setAttribute("r", "0");
      return;
    }
    const sourceBox = source.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    const startX = sourceBox.right - 2;
    const startY = sourceBox.top + sourceBox.height / 2;
    const endX = targetBox.left + 4;
    const endY = targetBox.top + 28;
    const bend = Math.max(70, Math.abs(endX - startX) * 0.55);
    path.setAttribute("d", `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`);
    if (endpoint) {
      endpoint.setAttribute("cx", String(endX));
      endpoint.setAttribute("cy", String(endY));
      endpoint.setAttribute("r", "4");
    }
  }

  #scheduleSave() {
    this.#renderPageMarkers();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.#persist(), 400);
  }

  #createDocument() {
    const now = new Date().toISOString();
    const document = { id: Date.now(), title: "Untitled work log", content: "", createdAt: now, updatedAt: now };
    this.documents.unshift(document);
    this.selectedId = document.id;
    this.selection = new Set([document.id]);
    this.selectionAnchorId = document.id;
    this.mode = "edit";
    this.#persist();
    this.#render();
    this.root.querySelector(".worklog-document-title")?.select();
  }

  #selectDocument(id, event) {
    const isRangeSelection = event.shiftKey && this.selectionAnchorId !== null;
    const isToggleSelection = event.ctrlKey || event.metaKey;
    if (isRangeSelection) {
      const start = this.documents.findIndex((document) => document.id === this.selectionAnchorId);
      const end = this.documents.findIndex((document) => document.id === id);
      const range = this.documents.slice(Math.min(start, end), Math.max(start, end) + 1).map((document) => document.id);
      this.selection = new Set(isToggleSelection ? [...this.selection, ...range] : range);
    } else if (isToggleSelection) {
      if (this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
      this.selectionAnchorId = id;
    } else {
      this.selection = new Set([id]);
      this.selectionAnchorId = id;
    }
    this.selectedId = id;
    this.mode = "edit";
    this.contextMenu = null;
    this.#persist();
    this.#render();
  }

  #deleteDocuments(ids) {
    if (!ids.length) return;
    const documentsToDelete = this.documents.filter((document) => ids.includes(document.id));
    const label = documentsToDelete.length === 1
      ? `Delete "${documentsToDelete[0].title || "Untitled work log"}" permanently?`
      : `Delete ${documentsToDelete.length} work logs permanently?`;
    if (!window.confirm(label)) return;
    this.documents = this.documents.filter((document) => !ids.includes(document.id));
    this.selectedId = this.documents[0]?.id || null;
    this.selection = this.selectedId === null ? new Set() : new Set([this.selectedId]);
    this.selectionAnchorId = this.selectedId;
    this.mode = "edit";
    this.contextMenu = null;
    this.#persist();
    this.#render();
  }

  #persist() {
    Storage.save(CONFIG.worklogStorageKey, { documents: this.documents, selectedId: this.selectedId });
  }

  #applyFormat(format) {
    const editor = this.root.querySelector(".worklog-editor");
    if (!editor) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selection = editor.value.slice(start, end) || "text";
    const formats = {
      heading: `## ${selection}`,
      bold: `**${selection}**`,
      italic: `*${selection}*`,
      list: `- ${selection}`,
      ordered: `1. ${selection}`,
      link: `[${selection}](https://)`,
      code: `\`\`\`\n${selection}\n\`\`\``,
    };
    const replacement = formats[format];
    editor.setRangeText(replacement, start, end, "end");
    const document = this.#selectedDocument();
    if (document) {
      document.content = editor.value;
      document.updatedAt = new Date().toISOString();
    }
    editor.focus();
    this.#scheduleSave();
  }

  async #pasteImageFromClipboard() {
    const editor = this.root.querySelector(".worklog-editor");
    if (!editor || !navigator.clipboard?.read) {
      this.#setImageStatus("Copy an image, then paste it into the editor.");
      return;
    }
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        await this.#insertClipboardImage(new File([blob], "clipboard-image", { type: imageType }), editor);
        return;
      }
      this.#setImageStatus("No image found in the clipboard.");
    } catch {
      this.#setImageStatus("Clipboard access was not available. Paste the image into the editor instead.");
    }
  }

  async #insertClipboardImage(file, editor) {
    const start = editor.selectionStart ?? editor.value.length;
    const end = editor.selectionEnd ?? start;
    this.#setImageStatus("Saving image...");
    try {
      const response = await fetch("/api/upload-worklog-image", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const result = await response.json();
      if (!response.ok || !result.path) throw new Error("Upload failed");

      const currentEditor = this.root.querySelector(".worklog-editor") || editor;
      currentEditor.setRangeText(`![image](${result.path})`, start, end, "end");
      const document = this.#selectedDocument();
      if (document) {
        document.content = currentEditor.value;
        document.updatedAt = new Date().toISOString();
      }
      this.#setImageStatus("Image saved to project assets.");
      this.#scheduleSave();
    } catch {
      this.#setImageStatus("Could not save the image. Start the local server and try again.");
    }
  }

  /* Theme colours the preview is currently using, so the exported page keeps
   * the same surface, border and accent colours. */
  #exportPalette() {
    const styles = getComputedStyle(document.documentElement);
    const read = (name, fallback) => (styles.getPropertyValue(name) || "").trim() || fallback;
    return {
      bg: read("--bg", "#f1f5f9"),
      surface: read("--surface", "#ffffff"),
      surfaceHover: read("--surface-hover", "#f8fafc"),
      border: read("--border", "#e2e8f0"),
      textPrimary: read("--text-primary", "#1e293b"),
      textSecondary: read("--text-secondary", "#64748b"),
      textMuted: read("--text-muted", "#94a3b8"),
      accent: read("--accent", CONFIG.accent || "#0d9488"),
      accentSoft: read("--accent-soft", "#f0fdfa"),
    };
  }

  #setImageStatus(message) {
    this.imageStatus = message;
    const status = this.root.querySelector(".worklog-image-status");
    if (status) status.textContent = message;
  }

  #setMarkdownImageWidth(content, targetIndex, width) {
    let imageIndex = -1;
    return content.replace(/!\[([^\]]*)\]\((\/assets\/worklog-images\/[a-zA-Z0-9._-]+)\)(?:\{width=\d{1,3}%\})?/g, (match, alt, path) => {
      imageIndex += 1;
      return imageIndex === targetIndex ? `![${alt}](${path}){width=${width}%}` : match;
    });
  }

  async #exportPdf() {
    const workLog = this.#selectedDocument();
    if (!workLog) return;
    this.#dismissContextMenu();
    this.#setImageStatus("Building PDF…");
    try {
      const { blob, filename, embeddedFont } = await WorkLogPdf.exportDocument({
        title: workLog.title || "Untitled work log",
        updatedAt: new Date(workLog.updatedAt).toLocaleString(),
        markdown: workLog.content || "",
        palette: this.#exportPalette(),
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      // Without the embedded fonts the page only looks right in viewers that
      // substitute their own CJK font, so say so instead of exporting quietly.
      this.#setImageStatus(embeddedFont
        ? `Exported ${filename}`
        : `Exported ${filename} — text fonts were not embedded. Restart the local server (node server.js) and reload this page, then export again.`);
    } catch (error) {
      console.error("PDF export failed:", error);
      this.#setImageStatus("PDF export failed. See the console for details.");
    }
  }

  #relativeDate(value) {
    if (!value) return "New";
    const difference = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
    if (difference <= 0) return "Today";
    if (difference === 1) return "Yesterday";
    return new Date(value).toLocaleDateString();
  }

  #escape(value) {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  }

  #escapeAttr(value) {
    return this.#escape(value).replace(/"/g, "&quot;");
  }

  #toMarkdown(source, expandImages = false, documentId = this.selectedId) {
    const issueBlocks = [];
    const sourceWithIssuePlaceholders = source.replace(/^:::issue ([a-zA-Z0-9_-]+) (Open|Completed)\r?\n([\s\S]*?)\r?\n:::end \1[ \t]*$/gm, (_, id, status, content) => {
      issueBlocks.push({ id, status, content });
      return `WORKLOGISSUEPLACEHOLDER${issueBlocks.length - 1}END`;
    });
    const escaped = this.#escape(sourceWithIssuePlaceholders);
    const codeBlocks = [];
    let imageIndex = -1;
    let html = escaped.replace(/```([\s\S]*?)```/g, (_, code) => {
      codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
      return `\u0000CODE${codeBlocks.length - 1}\u0000`;
    });
    // Generic Markdown rules come from the shared renderer, so a file
    // in docs and an entry here are rendered by the same definitions.
    // What follows is work-log-specific: images carry a width control,
    // and [[task:…]] / [[resource:…]] expand against app state.
    html = Markdown.inline(Markdown.blocks(html))
      .replace(/!\[([^\]]*)\]\((\/assets\/worklog-images\/[a-zA-Z0-9._-]+)\)(?:\{width=(\d{1,3})%\})?/g, (_, alt, path, savedWidth) => {
        imageIndex += 1;
        const width = Math.max(10, Math.min(100, Number(savedWidth) || 100));
        const image = `<img src="${path}" alt="${alt}" style="width:${width}%;max-width:100%;height:auto">`;
        return expandImages
          ? image
          : `<details class="worklog-image" data-image-index="${imageIndex}" data-image-path="${this.#escapeAttr(path)}" ${this.expandedImages.get(`${documentId}:${path}`) ? "open" : ""}><summary>${alt || "Image"}</summary>${image}<label class="worklog-image-size"><span>Width</span><input class="worklog-image-width" type="range" min="10" max="100" step="5" value="${width}" data-image-index="${imageIndex}" aria-label="Image width"><output>${width}%</output></label></details>`;
      })
      .replace(/\[\[resource:(url|file):([^|\]]+)\|([^\]]+)\]\]/g, (_, kind, target, label) => {
        let decodedTarget = target;
        try { decodedTarget = decodeURIComponent(target); } catch { /* Keep malformed legacy references readable. */ }
        const type = kind === "url" ? "URL" : /\.pdf$/i.test(decodedTarget) ? "PDF" : "File";
        return `<button class="worklog-resource-reference" data-action="show-resource-preview" data-kind="${kind}" data-target="${target}" data-label="${this.#escapeAttr(label)}"><span>${this.#escape(label)}</span><small>${type}</small></button>`;
      })
      .replace(/\[\[task:calendar:(\d{4}-\d{2}-\d{2}):(\d+)\|([^\]]+)\]\]/g, (_, date, id, fallback) => {
        const task = CalendarStorage.getTasks(date).find((item) => item.id === Number(id));
        const title = task ? this.#escape(task.abstract || "Untitled") : fallback;
        const accessibleLabel = task ? `${task.abstract || "Untitled"} · ${date}` : `${fallback} · ${date}`;
        return `<button class="worklog-task-reference" data-action="show-task-reference" data-kind="calendar" data-date="${date}" data-id="${id}" title="${this.#escapeAttr(accessibleLabel)}"><span>${title}</span><small>${date}</small></button>`;
      })
      .replace(/\[\[task:longterm:(\d+)\|([^\]]+)\]\]/g, (_, id, fallback) => {
        const tasks = LongTermStorage.loadAll();
        const task = LongTermStorage.findNode(tasks, Number(id));
        const path = task ? LongTermStorage.getNodePath(tasks, Number(id)) : null;
        const title = path ? this.#escape(path) : fallback;
        const date = task?.scheduledDate || "Not scheduled";
        const accessibleLabel = `${path || fallback} · ${date}`;
        return `<button class="worklog-task-reference" data-action="show-task-reference" data-kind="longterm" data-id="${id}" title="${this.#escapeAttr(accessibleLabel)}"><span>${title}</span><small>${this.#escape(date)}</small></button>`;
      })
      ;

    html = html.replace(/(?:^|\n)- (.+)(?=(?:\n- |\n\n|$))/g, (_, item) => `<li>${item}</li>`);
    html = html.replace(/(<li>[\s\S]*?<\/li>)(?:\n|$)/g, "$1");
    html = html.replace(/((?:<li>.*?<\/li>){1,})/g, "<ul>$1</ul>");
    html = html.replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
    html = `<p>${html}</p>`
      .replace(/<p>(<h[1-3]>[\s\S]*?<\/h[1-3]>|<blockquote>[\s\S]*?<\/blockquote>|<hr>|<pre>[\s\S]*?<\/pre>|<ul>[\s\S]*?<\/ul>|<details[\s\S]*?<\/details>|WORKLOGISSUEPLACEHOLDER\d+END)<\/p>/g, "$1")
      .replace(/WORKLOGISSUEPLACEHOLDER(\d+)END/g, (_, index) => this.#issueBlockHTML(issueBlocks[Number(index)], documentId, expandImages))
      .replace(/\u0000CODE(\d+)\u0000/g, (_, index) => codeBlocks[index]);
    return html;
  }

  #issueBlockHTML(issue, documentId, expandContent) {
    const nextState = issue.status === "Open" ? "Completed" : "Open";
    const stateControl = expandContent
      ? `<span class="worklog-issue-state is-${issue.status.toLowerCase()}">${issue.status}</span>`
      : `<button class="worklog-issue-state is-${issue.status.toLowerCase()}" data-action="toggle-issue-state" data-document-id="${documentId}" data-issue-id="${issue.id}" title="Mark ${nextState.toLowerCase()}">${issue.status}</button>`;
    let content = issue.content.trim()
      ? this.#toMarkdown(issue.content, expandContent, documentId)
      : '<p class="worklog-issues-empty">No details yet.</p>';
    const firstLine = issue.content.split(/\r?\n/).find((line) => line.trim()) || "";
    if (/^#{1,3}\s/.test(firstLine)) {
      content = content.replace(/<h([1-3])>/, '<h$1 class="worklog-issue-title-heading">');
    }
    return `<article class="worklog-issue"><header><span class="worklog-issue-label">Problem</span>${stateControl}</header><div class="worklog-issue-content">${content}</div></article>`;
  }
}