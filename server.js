/**
 * Daily Studio — Local Server
 *
 * Serves the frontend and provides a REST API for automatic
 * file-based persistence.  Zero dependencies — uses only
 * Node.js built-in modules.
 *
 * Usage:  node server.js
 */

const http = require("http");
const fs   = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "daily-studio-data.json");
const LONGTERM_FILE = path.join(ROOT, "daily-studio-longterm.json");
const ICONS_DIR = path.join(ROOT, "icons");
const ASSETS_DIR = path.join(ROOT, "assets");
const WORKLOG_IMAGES_DIR = path.join(ROOT, "assets", "worklog-images");
const WORKLOG_FILES_DIR = path.join(ROOT, "assets", "worklog-files");
const WORKLOG_IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
const MAX_WORKLOG_TEXT_SIZE = 10 * 1024 * 1024;
const MAX_WORKLOG_PDF_SIZE = 50 * 1024 * 1024;

// ── Docs library ─────────────────────────────────────────────
// Files the docs page manages live here; the shelf layout (names,
// order) is a small JSON file beside the other stores.
const DOCS_DIR = path.join(ROOT, "docs");
const DOCS_FILE = path.join(ROOT, "daily-studio-docs.json");
const MAX_DOC_SIZE = 25 * 1024 * 1024;
const DOC_UPLOAD_TYPES = {
  "text/plain": "txt",
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
// Images inserted into a note travel a separate path from shelf files.
// Uploads to a shelf stay text/PDF only; an illustration is an attachment
// of the note, so it lands in the shelf's own images/ subfolder and never
// shows up as a book of its own (listShelfFiles only lists files).
const DOC_IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const DOC_PREVIEW_EXT = new Set([".txt", ".md", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

// Seeded on first run, then owned by the JSON file — editing a shelf
// name in the UI rewrites it.
const DEFAULT_DOC_SHELVES = [
  { id: "library", name: "Library", note: "Text and PDFs you keep here", kind: "files" },
];

// ── MIME types for static files ──────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
  ".pdf":  "application/pdf",
  ".txt":  "text/plain; charset=utf-8",
  ".md":   "text/plain; charset=utf-8",
};

// ── Helpers ──────────────────────────────────────────────────

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function reply(res, status, body, contentType = "application/json") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function isLocalWorklogRequest(req) {
  const host = req.headers.host || "";
  const remoteAddress = req.socket.remoteAddress || "";
  const isLoopbackClient = remoteAddress === "::1" || remoteAddress.startsWith("127.") || remoteAddress.startsWith("::ffff:127.");
  const isLoopbackHost = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(host);
  let originMatches = true;
  if (req.headers.origin) {
    try { originMatches = new URL(req.headers.origin).host === host; }
    catch { originMatches = false; }
  }
  return isLoopbackClient && isLoopbackHost && originMatches;
}

// System fonts the PDF exporter subsets, grouped the way the preview's font
// stack resolves: the UI font covers Latin text, the mono font covers code and
// the CJK font covers everything else. Only the faces actually used end up in
// the exported file.
const WORKLOG_PDF_FONTS = {
  ui: {
    regular: ["C:/Windows/Fonts/segoeui.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf"],
    // `font-weight: 600` resolves to Semibold on Windows; without it the
    // exporter falls back to the bold face.
    semibold: ["C:/Windows/Fonts/seguisb.ttf"],
    bold: ["C:/Windows/Fonts/segoeuib.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"],
    italic: ["C:/Windows/Fonts/segoeuii.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf", "/System/Library/Fonts/Supplemental/Arial Italic.ttf"],
    boldItalic: ["C:/Windows/Fonts/segoeuiz.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf", "/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf"],
  },
  mono: {
    regular: ["C:/Windows/Fonts/consola.ttf", "C:/Windows/Fonts/cour.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf"],
    bold: ["C:/Windows/Fonts/consolab.ttf", "C:/Windows/Fonts/courbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"],
    italic: ["C:/Windows/Fonts/consolai.ttf", "C:/Windows/Fonts/couri.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Oblique.ttf", "/usr/share/fonts/truetype/liberation/LiberationMono-Italic.ttf"],
    boldItalic: ["C:/Windows/Fonts/consolaz.ttf", "C:/Windows/Fonts/courbi.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-BoldOblique.ttf", "/usr/share/fonts/truetype/liberation/LiberationMono-BoldItalic.ttf"],
  },
  cjk: {
    regular: ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/msyh.ttf", "C:/Windows/Fonts/Deng.ttf", "C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/simsun.ttc", "/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"],
    bold: ["C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/simhei.ttf", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc"],
  },
};

function findWorklogPdfFont(role, style) {
  const faces = WORKLOG_PDF_FONTS[role];
  const candidates = faces && faces[style];
  if (!candidates) return null;
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* Not installed on this machine. */ }
  }
  return null;
}

function isUtf8Text(buffer) {
  if (buffer.includes(0)) return false;
  return Buffer.from(buffer.toString("utf8"), "utf8").equals(buffer);
}

function collectReferencedAssetPaths() {
  const data = readDataFile();
  const worklog = data.ds_worklog || {};
  const documents = Array.isArray(worklog.documents)
    ? worklog.documents
    : typeof worklog.content === "string" ? [{ content: worklog.content }] : [];
  const references = new Set();

  const addReference = (rawPath) => {
    let filePath = rawPath.trim();
    try { filePath = decodeURIComponent(filePath); } catch { /* Keep malformed legacy references readable. */ }
    if (filePath.startsWith("file://")) {
      try { filePath = new URL(filePath).pathname; } catch { return; }
    }
    if (/^\/assets\//i.test(filePath)) filePath = filePath.replace(/^\/+/, "");
    const resolved = path.resolve(ROOT, filePath);
    const relative = path.relative(ASSETS_DIR, resolved);
    if (relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
      references.add(path.resolve(resolved));
    }
  };

  for (const document of documents) {
    const content = typeof document.content === "string" ? document.content : "";
    for (const match of content.matchAll(/\[\[resource:file:([^|\]]+)\|[^\]]+\]\]/g)) addReference(match[1]);
    for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) addReference(match[1]);
  }
  return references;
}

async function collectUnusedAssets() {
  const referenced = collectReferencedAssetPaths();
  const files = [];
  const walk = async (directory) => {
    let entries;
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filePath);
      else if (entry.isFile() && !referenced.has(path.resolve(filePath))) {
        files.push(path.relative(ROOT, filePath).split(path.sep).join("/"));
      }
    }
  };
  await walk(ASSETS_DIR);
  return files.sort();
}

function readDataFile() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};  // file doesn't exist yet or is invalid → empty
  }
}

function writeDataFile(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function readLongtermFile() {
  try {
    const raw = fs.readFileSync(LONGTERM_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeLongtermFile(data) {
  fs.writeFileSync(LONGTERM_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// ── Docs helpers ─────────────────────────────────────────────
// Each shelf owns a folder of its own, docs/<shelfId>/. That keeps the
// filesystem the source of truth: two shelves can never show the same
// file, and deleting a shelf is deleting a directory.
//
// Uploads are capped to the kinds asked for: text you type or upload,
// and PDFs you upload.

const DOC_UPLOAD_EXT = new Set([".txt", ".md", ".pdf"]);

function readDocsStore() {
  let store;
  try { store = JSON.parse(fs.readFileSync(DOCS_FILE, "utf-8")); } catch { store = {}; }
  if (!Array.isArray(store.shelves) || !store.shelves.length) {
    store.shelves = DEFAULT_DOC_SHELVES.map((s) => Object.assign({}, s));
  }
  return store;
}

function writeDocsStore(store) {
  fs.writeFileSync(DOCS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

/** A bare filename, or null. Anything able to escape the shelf is out. */
function safeDocName(raw) {
  const base = path.basename(String(raw == null ? "" : raw).trim());
  if (!base || base === "." || base === ".." || base.length > 120) return null;
  if (/[<>:"/\\|?*\x00-\x1f]/.test(base)) return null;
  return base;
}

/** A shelf id usable as a folder name, unique within `taken`. */
function makeShelfId(name, taken) {
  const base = String(name || "shelf").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "shelf";
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = base + "-" + n;
  return id;
}

function docsDirFor(shelfId) {
  return path.join(DOCS_DIR, shelfId);
}

/** Resolve a shelf by id, or null. Only manageable shelves are returned. */
function shelffById(store, id) {
  return store.shelves.find((s) => s.id === id && s.kind === "files") || null;
}

async function listShelfFiles(shelfId) {
  const dir = docsDirFor(shelfId);
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
  catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    if (!DOC_PREVIEW_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    try {
      const stats = await fs.promises.stat(path.join(dir, entry.name));
      out.push({ name: entry.name, ext: path.extname(entry.name).slice(1).toLowerCase(),
                 size: stats.size, mtime: stats.mtime.toISOString() });
    } catch { /* raced with a delete — skip it */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function docsImageDir(shelfId) {
  return path.join(DOCS_DIR, shelfId, "images");
}

/** Collect a request body, refusing anything over maxBytes. */
function readBody(req, res, maxBytes, onDone) {
  const chunks = [];
  let size = 0;
  let stopped = false;
  req.on("data", (chunk) => {
    if (stopped) return;
    size += chunk.length;
    if (size > maxBytes) {
      stopped = true;
      reply(res, 413, JSON.stringify({ ok: false, error: "File too large" }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => { if (!stopped) onDone(Buffer.concat(chunks)); });
  req.on("error", () => {
    if (!stopped) { stopped = true; reply(res, 500, JSON.stringify({ ok: false, error: "Read failed" })); }
  });
}

/** Write a file into one shelf's folder, under a validated name. */
function saveDoc(shelfId, name, data, res) {
  const dir = docsDirFor(shelfId);
  try { fs.mkdirSync(dir, { recursive: true }); }
  catch (error) { reply(res, 500, JSON.stringify({ ok: false, error: error.message })); return; }
  fs.writeFile(path.join(dir, name), data, (error) => {
    if (error) reply(res, 500, JSON.stringify({ ok: false, error: "Write failed" }));
    else reply(res, 200, JSON.stringify({ ok: true, name }));
  });
}

/** JSON body → object, or null when it does not parse. */
function parseJson(raw) {
  try { return JSON.parse(raw.toString("utf-8")); }
  catch { return null; }
}

// ── Router ───────────────────────────────────────────────────

function serveStatic(urlPath, res) {
  // Prevent directory traversal
  const safe = path.normalize(urlPath).replace(/^(\.\.\/)+/, "");
  const filePath = path.join(ROOT, safe);

  // Only serve files under ROOT
  if (!filePath.startsWith(ROOT)) {
    reply(res, 403, "Forbidden", "text/plain");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        // An unknown API route is a client error. Answering with the single
        // page app would look like a successful but nonsensical response.
        if (urlPath.startsWith("/api/")) {
          reply(res, 404, JSON.stringify({ ok: false, error: "Unknown API endpoint" }));
          return;
        }
        // SPA fallback: serve index.html for unknown paths
        fs.readFile(path.join(ROOT, "index.html"), (err2, html) => {
          if (err2) { reply(res, 500, "Internal Server Error", "text/plain"); return; }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        });
        return;
      }
      reply(res, 500, "Internal Server Error", "text/plain");
      return;
    }
    const headers = { "Content-Type": mime };
    // App code is revalidated on every load so edits take effect on a normal
    // refresh instead of being served from the browser cache.
    if (ext === ".html" || ext === ".js" || ext === ".css") headers["Cache-Control"] = "no-cache";
    if (ext === ".html") {
      // Stamp asset URLs with their modification time, so a changed script or
      // stylesheet is a new URL and never comes from a stale cache.
      const html = data.toString("utf8").replace(/(src|href)="((?:js|css)\/[^"?]+)"/g, (match, attribute, assetPath) => {
        try {
          const stat = fs.statSync(path.join(ROOT, assetPath));
          return `${attribute}="${assetPath}?v=${Math.floor(stat.mtimeMs)}"`;
        } catch {
          return match;
        }
      });
      res.writeHead(200, headers);
      res.end(html);
      return;
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

function handleRequest(req, res) {
  setCORS(res);

  // Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // ── API routes ──────────────────────────────────────────
  if (pathname === "/api/data") {
    if (req.method === "GET") {
      const data = readDataFile();
      reply(res, 200, JSON.stringify(data));
      return;
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          writeDataFile(data);
          reply(res, 200, JSON.stringify({ ok: true }));
        } catch (err) {
          reply(res, 400, JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    reply(res, 405, "Method Not Allowed", "text/plain");
    return;
  }

  // ── Long-term data (separate file) ───────────────────────
  if (pathname === "/api/longterm") {
    if (req.method === "GET") {
      const data = readLongtermFile();
      reply(res, 200, JSON.stringify(data));
      return;
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          writeLongtermFile(data);
          reply(res, 200, JSON.stringify({ ok: true }));
        } catch (err) {
          reply(res, 400, JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    reply(res, 405, "Method Not Allowed", "text/plain");
    return;
  }

  // ── Icon upload ──────────────────────────────────────────
  if (pathname === "/api/upload-icon" && req.method === "POST") {
    const ext = (url.searchParams.get("ext") || "png").replace(/[^a-z0-9]/gi, "");
    const name = `icon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = path.join(ICONS_DIR, name);

    // Ensure icons directory exists
    if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR, { recursive: true });

    const ws = fs.createWriteStream(filePath);
    req.pipe(ws);
    ws.on("finish", () => reply(res, 200, JSON.stringify({ ok: true, path: `/icons/${name}` })));
    ws.on("error", () => reply(res, 500, JSON.stringify({ ok: false, error: "Write failed" })));
    return;
  }

  // ── Work log clipboard image upload ──────────────────────
  if (pathname === "/api/upload-worklog-image" && req.method === "POST") {
    const contentType = (req.headers["content-type"] || "").split(";")[0].toLowerCase();
    const ext = WORKLOG_IMAGE_TYPES[contentType];
    if (!ext) {
      reply(res, 415, JSON.stringify({ ok: false, error: "Unsupported image type" }));
      return;
    }

    const name = `worklog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = path.join(WORKLOG_IMAGES_DIR, name);
    if (!fs.existsSync(WORKLOG_IMAGES_DIR)) fs.mkdirSync(WORKLOG_IMAGES_DIR, { recursive: true });

    const ws = fs.createWriteStream(filePath);
    req.pipe(ws);
    ws.on("finish", () => reply(res, 200, JSON.stringify({ ok: true, path: `/assets/worklog-images/${name}` })));
    ws.on("error", () => reply(res, 500, JSON.stringify({ ok: false, error: "Write failed" })));
    return;
  }

  // ── Work log PDF export font ────────────────────────────
  // Streams one system font face (role: ui | mono | cjk, style: regular |
  // bold | italic | boldItalic) that the PDF exporter subsets and embeds, so
  // exported documents show the same typefaces as the editor preview.
  if (pathname === "/api/worklog-font" && req.method === "GET") {
    res.removeHeader("Access-Control-Allow-Origin");
    if (!isLocalWorklogRequest(req)) {
      reply(res, 403, JSON.stringify({ ok: false, error: "The export font is only available to this computer." }));
      return;
    }
    const role = url.searchParams.get("role") || "cjk";
    const style = url.searchParams.get("style") || "regular";
    const fontPath = findWorklogPdfFont(role, style);
    if (!fontPath) {
      reply(res, 404, JSON.stringify({ ok: false, error: `No ${role}/${style} system font was found for PDF export.` }));
      return;
    }
    fs.readFile(fontPath, (error, data) => {
      if (error) {
        reply(res, 500, JSON.stringify({ ok: false, error: "Could not read the system font." }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": data.length,
        "X-Font-Name": path.basename(fontPath),
      });
      res.end(data);
    });
    return;
  }

  // ── Work log local text preview ─────────────────────────
  if (pathname === "/api/worklog-text" && req.method === "GET") {
    res.removeHeader("Access-Control-Allow-Origin");
    if (!isLocalWorklogRequest(req)) {
      reply(res, 403, JSON.stringify({ ok: false, error: "Local text preview is only available to this computer." }));
      return;
    }

    const requestedPath = url.searchParams.get("path") || "";
    if (!requestedPath || requestedPath.includes("\0")) {
      reply(res, 400, JSON.stringify({ ok: false, error: "Choose a file path." }));
      return;
    }

    const filePath = path.resolve(ROOT, requestedPath);

    fs.realpath(filePath, (realPathError, realPath) => {
      if (realPathError) {
        reply(res, 404, JSON.stringify({ ok: false, error: "Text file not found." }));
        return;
      }
      fs.stat(realPath, (statError, stats) => {
        if (statError || !stats.isFile()) {
          reply(res, 404, JSON.stringify({ ok: false, error: "Text file not found." }));
          return;
        }
        if (stats.size > MAX_WORKLOG_TEXT_SIZE) {
          reply(res, 413, JSON.stringify({ ok: false, error: "Text files must be 10 MB or smaller." }));
          return;
        }
        fs.readFile(realPath, (readError, buffer) => {
          if (readError) {
            reply(res, 500, JSON.stringify({ ok: false, error: "Could not read the text file." }));
            return;
          }
          if (!isUtf8Text(buffer)) {
            reply(res, 415, JSON.stringify({ ok: false, error: "This file is not UTF-8 text." }));
            return;
          }
          const content = buffer.toString("utf8");
          reply(res, 200, JSON.stringify({ ok: true, path: realPath, content }));
        });
      });
    });
    return;
  }

  if (pathname === "/api/worklog-pdf" && req.method === "GET") {
    res.removeHeader("Access-Control-Allow-Origin");
    if (!isLocalWorklogRequest(req)) {
      reply(res, 403, JSON.stringify({ ok: false, error: "Local PDF preview is only available to this computer." }));
      return;
    }
    const requestedPath = url.searchParams.get("path") || "";
    if (!requestedPath || requestedPath.includes("\0") || path.extname(requestedPath).toLowerCase() !== ".pdf") {
      reply(res, 400, JSON.stringify({ ok: false, error: "Choose a PDF file." }));
      return;
    }
    fs.realpath(path.resolve(ROOT, requestedPath), (realPathError, realPath) => {
      if (realPathError) {
        reply(res, 404, JSON.stringify({ ok: false, error: "PDF file not found." }));
        return;
      }
      fs.stat(realPath, (statError, stats) => {
        if (statError || !stats.isFile()) {
          reply(res, 404, JSON.stringify({ ok: false, error: "PDF file not found." }));
          return;
        }
        if (stats.size > MAX_WORKLOG_PDF_SIZE) {
          reply(res, 413, JSON.stringify({ ok: false, error: "PDF files must be 50 MB or smaller." }));
          return;
        }
        fs.readFile(realPath, (readError, buffer) => {
          if (readError) {
            reply(res, 500, JSON.stringify({ ok: false, error: "Could not read the PDF file." }));
            return;
          }
          if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
            reply(res, 415, JSON.stringify({ ok: false, error: "This file is not a valid PDF." }));
            return;
          }
          res.writeHead(200, {
            "Content-Type": "application/pdf",
            "Content-Disposition": "inline",
            "Content-Length": buffer.length,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          res.end(buffer);
        });
      });
    });
    return;
  }

  if (pathname === "/api/worklog-asset-preview" && req.method === "GET") {
    res.removeHeader("Access-Control-Allow-Origin");
    if (!isLocalWorklogRequest(req)) {
      reply(res, 403, JSON.stringify({ ok: false, error: "Asset preview is only available to this computer." }));
      return;
    }
    const requestedPath = url.searchParams.get("path") || "";
    if (!requestedPath || requestedPath.includes("\0")) {
      reply(res, 400, JSON.stringify({ ok: false, error: "Choose an asset path." }));
      return;
    }
    const filePath = path.resolve(ROOT, requestedPath);
    fs.realpath(filePath, (realPathError, realPath) => {
      if (realPathError) {
        reply(res, 404, JSON.stringify({ ok: false, error: "Asset file not found." }));
        return;
      }
      const relativeAssetPath = path.relative(ASSETS_DIR, realPath);
      if (!relativeAssetPath || relativeAssetPath === ".." || relativeAssetPath.startsWith(`..${path.sep}`) || path.isAbsolute(relativeAssetPath)) {
        reply(res, 403, JSON.stringify({ ok: false, error: "Only files inside assets/ can be previewed here." }));
        return;
      }
      fs.stat(realPath, (statError, stats) => {
        if (statError || !stats.isFile()) {
          reply(res, 404, JSON.stringify({ ok: false, error: "Asset file not found." }));
          return;
        }
        const previewSize = Math.min(stats.size, 1024 * 1024);
        fs.open(realPath, "r", (openError, descriptor) => {
          if (openError) {
            reply(res, 500, JSON.stringify({ ok: false, error: "Could not read asset file." }));
            return;
          }
          const buffer = Buffer.alloc(previewSize);
          fs.read(descriptor, buffer, 0, previewSize, 0, (readError, bytesRead) => {
            fs.close(descriptor, () => {});
            if (readError) {
              reply(res, 500, JSON.stringify({ ok: false, error: "Could not read asset file." }));
              return;
            }
            const sample = buffer.subarray(0, bytesRead);
            const isText = isUtf8Text(sample) && !sample.includes(0);
            reply(res, 200, JSON.stringify({
              ok: true,
              path: path.relative(ROOT, realPath).split(path.sep).join("/"),
              size: stats.size,
              truncated: stats.size > bytesRead,
              kind: isText ? "text" : "binary",
              content: isText ? sample.toString("utf8") : [...sample.subarray(0, 512)].map((byte) => byte.toString(16).padStart(2, "0")).join(" "),
            }));
          });
        });
      });
    });
    return;
  }

  if (pathname === "/api/copy-worklog-text" && req.method === "POST") {
    res.removeHeader("Access-Control-Allow-Origin");
    if (!isLocalWorklogRequest(req)) {
      reply(res, 403, JSON.stringify({ ok: false, error: "Local text copy is only available to this computer." }));
      return;
    }

    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) { tooLarge = true; body = ""; }
    });
    req.on("end", () => {
      if (tooLarge) {
        reply(res, 413, JSON.stringify({ ok: false, error: "Invalid file path." }));
        return;
      }
      let source;
      try { source = JSON.parse(body).path; }
      catch { reply(res, 400, JSON.stringify({ ok: false, error: "Invalid request." })); return; }
      if (typeof source !== "string" || !source.trim() || source.includes("\0")) {
        reply(res, 400, JSON.stringify({ ok: false, error: "Choose a file path." }));
        return;
      }

      fs.realpath(path.resolve(ROOT, source), (realPathError, realPath) => {
        if (realPathError) {
          reply(res, 404, JSON.stringify({ ok: false, error: "Text file not found." }));
          return;
        }
        fs.stat(realPath, (statError, stats) => {
          if (statError || !stats.isFile()) {
            reply(res, 404, JSON.stringify({ ok: false, error: "File not found." }));
            return;
          }
          const isPdf = path.extname(realPath).toLowerCase() === ".pdf";
          const maxSize = isPdf ? MAX_WORKLOG_PDF_SIZE : MAX_WORKLOG_TEXT_SIZE;
          if (stats.size > maxSize) {
            reply(res, 413, JSON.stringify({ ok: false, error: isPdf ? "PDF files must be 50 MB or smaller." : "Text files must be 10 MB or smaller." }));
            return;
          }
          fs.readFile(realPath, (readError, buffer) => {
            if (readError) {
              reply(res, 500, JSON.stringify({ ok: false, error: "Could not read the text file." }));
              return;
            }
            if (isPdf ? buffer.subarray(0, 5).toString("ascii") !== "%PDF-" : !isUtf8Text(buffer)) {
              reply(res, 415, JSON.stringify({ ok: false, error: isPdf ? "This file is not a valid PDF." : "This file is not UTF-8 text or a PDF." }));
              return;
            }

            const baseName = path.basename(realPath).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "document.txt";
            const name = `worklog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${baseName}`;
            const destination = path.join(WORKLOG_FILES_DIR, name);
            fs.mkdir(WORKLOG_FILES_DIR, { recursive: true }, (mkdirError) => {
              if (mkdirError) {
                reply(res, 500, JSON.stringify({ ok: false, error: "Could not create the project file folder." }));
                return;
              }
              fs.writeFile(destination, buffer, { flag: "wx" }, (writeError) => {
                if (writeError) {
                  reply(res, 500, JSON.stringify({ ok: false, error: "Could not copy the file." }));
                  return;
                }
                reply(res, 200, JSON.stringify({ ok: true, path: `assets/worklog-files/${name}` }));
              });
            });
          });
        });
      });
    });
    return;
  }

  if (pathname === "/api/worklog-assets/unused" && req.method === "GET") {
    res.removeHeader("Access-Control-Allow-Origin");
    if (!isLocalWorklogRequest(req)) {
      reply(res, 403, JSON.stringify({ ok: false, error: "Asset cleanup is only available to this computer." }));
      return;
    }
    collectUnusedAssets()
      .then((files) => reply(res, 200, JSON.stringify({ ok: true, files, count: files.length })))
      .catch((error) => reply(res, 500, JSON.stringify({ ok: false, error: error.message })));
    return;
  }

  if (pathname === "/api/worklog-assets/cleanup" && req.method === "POST") {
    res.removeHeader("Access-Control-Allow-Origin");
    if (!isLocalWorklogRequest(req)) {
      reply(res, 403, JSON.stringify({ ok: false, error: "Asset cleanup is only available to this computer." }));
      return;
    }
    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 256 * 1024) { tooLarge = true; body = ""; }
    });
    req.on("end", async () => {
      if (tooLarge) { reply(res, 413, JSON.stringify({ ok: false, error: "Selection is too large." })); return; }
      let requestedFiles;
      try { requestedFiles = JSON.parse(body).files; }
      catch { reply(res, 400, JSON.stringify({ ok: false, error: "Invalid request." })); return; }
      if (!Array.isArray(requestedFiles) || requestedFiles.some((file) => typeof file !== "string")) {
        reply(res, 400, JSON.stringify({ ok: false, error: "Select one or more asset files." }));
        return;
      }
      try {
        const currentUnused = new Set(await collectUnusedAssets());
        const files = [...new Set(requestedFiles)].filter((file) => currentUnused.has(file));
        const results = await Promise.all(files.map(async (relativePath) => {
          try {
            await fs.promises.unlink(path.resolve(ROOT, relativePath));
            return { path: relativePath, deleted: true };
          } catch (error) {
            return { path: relativePath, deleted: false, error: error.message };
          }
        }));
        const deleted = results.filter((result) => result.deleted).map((result) => result.path);
        const failed = results.filter((result) => !result.deleted);
        const skipped = [...new Set(requestedFiles)].filter((file) => !currentUnused.has(file));
        reply(res, 200, JSON.stringify({ ok: true, deleted, failed, skipped, count: deleted.length }));
      } catch (error) {
        reply(res, 500, JSON.stringify({ ok: false, error: error.message }));
      }
    });
    return;
  }

  // ── Docs library ────────────────────────────────────────
  // One call gets the whole page: every shelf with the files it holds.
  if (pathname === "/api/docs" && req.method === "GET") {
    const store = readDocsStore();
    Promise.all(store.shelves.map(async (shelf) => Object.assign({}, shelf, {
      files: shelf.kind === "files" ? await listShelfFiles(shelf.id) : [],
    })))
      .then((shelves) => {
        if (!fs.existsSync(DOCS_FILE)) writeDocsStore(store);   // seed on first run
        reply(res, 200, JSON.stringify({ ok: true, shelves }));
      })
      .catch((error) => reply(res, 500, JSON.stringify({ ok: false, error: error.message })));
    return;
  }

  // Shelf management: rename / add / remove.
  if (pathname === "/api/docs/shelves" && req.method === "POST") {
    readBody(req, res, 64 * 1024, (raw) => {
      const payload = parseJson(raw);
      if (!payload || !payload.action) {
        reply(res, 400, JSON.stringify({ ok: false, error: "action is required" }));
        return;
      }
      const store = readDocsStore();
      const clean = (v) => String(v == null ? "" : v).trim().slice(0, 60);

      if (payload.action === "rename") {
        const shelf = store.shelves.find((s) => s.id === payload.id);
        const name = clean(payload.name);
        if (!shelf || !name) {
          reply(res, 400, JSON.stringify({ ok: false, error: "Bad shelf or name" }));
          return;
        }
        shelf.name = name;
      } else if (payload.action === "add") {
        const name = clean(payload.name) || "New shelf";
        const taken = new Set(store.shelves.map((s) => s.id));
        const shelf = { id: makeShelfId(name, taken), name, note: "", kind: "files" };
        store.shelves.push(shelf);
        try { fs.mkdirSync(docsDirFor(shelf.id), { recursive: true }); }
        catch (error) { reply(res, 500, JSON.stringify({ ok: false, error: error.message })); return; }
      } else if (payload.action === "remove") {
        const index = store.shelves.findIndex((s) => s.id === payload.id);
        if (index === -1) {
          reply(res, 404, JSON.stringify({ ok: false, error: "No such shelf" }));
          return;
        }
        if (store.shelves.length <= 1) {
          reply(res, 400, JSON.stringify({ ok: false, error: "Keep at least one shelf" }));
          return;
        }
        const gone = store.shelves.splice(index, 1)[0];
        // The shelf's folder goes with it — that is what removing a
        // shelf means. The dialog spells out the file count first.
        if (gone.kind === "files") {
          fs.rm(docsDirFor(gone.id), { recursive: true, force: true }, () => {});
        }
      } else {
        reply(res, 400, JSON.stringify({ ok: false, error: "Unknown action" }));
        return;
      }

      writeDocsStore(store);
      reply(res, 200, JSON.stringify({ ok: true, shelves: store.shelves }));
    });
    return;
  }

  // Upload a file. Raw body; name and shelf ride in headers, as with the
  // work-log image upload.
  if (pathname === "/api/docs/upload" && req.method === "POST") {
    const store = readDocsStore();
    const shelf = shelffById(store, req.headers["x-doc-shelf"]);
    if (!shelf) {
      reply(res, 400, JSON.stringify({ ok: false, error: "Unknown shelf" }));
      return;
    }
    let rawName = "";
    try { rawName = decodeURIComponent(req.headers["x-doc-name"] || ""); } catch { rawName = ""; }
    const name = safeDocName(rawName);
    if (!name) {
      reply(res, 400, JSON.stringify({ ok: false, error: "Bad file name" }));
      return;
    }
    if (!DOC_UPLOAD_EXT.has(path.extname(name).toLowerCase())) {
      reply(res, 415, JSON.stringify({ ok: false, error: "Only .txt and .pdf uploads are supported" }));
      return;
    }
    readBody(req, res, MAX_DOC_SIZE, (data) => saveDoc(shelf.id, name, data, res));
    return;
  }

  // Create or overwrite a text file from the editor.
  if ((pathname === "/api/docs/new" || pathname === "/api/docs/save") && req.method === "POST") {
    const isSave = pathname.endsWith("/save");
    readBody(req, res, MAX_WORKLOG_TEXT_SIZE, (raw) => {
      const payload = parseJson(raw);
      if (!payload) {
        reply(res, 400, JSON.stringify({ ok: false, error: "Bad request" }));
        return;
      }
      const store = readDocsStore();
      const shelf = shelffById(store, payload.shelf);
      if (!shelf) {
        reply(res, 400, JSON.stringify({ ok: false, error: "Unknown shelf" }));
        return;
      }
      const given = safeDocName(payload.name);
      if (!given) {
        reply(res, 400, JSON.stringify({ ok: false, error: "Bad file name" }));
        return;
      }
      const name = (isSave || path.extname(given)) ? given : given + ".txt";
      if (!DOC_UPLOAD_EXT.has(path.extname(name).toLowerCase())) {
        reply(res, 415, JSON.stringify({ ok: false, error: "Only text files can be written here" }));
        return;
      }
      if (isSave && !fs.existsSync(path.join(docsDirFor(shelf.id), name))) {
        reply(res, 404, JSON.stringify({ ok: false, error: "No such file" }));
        return;
      }
      const content = typeof payload.content === "string" ? payload.content : "";
      saveDoc(shelf.id, name, Buffer.from(content, "utf-8"), res);
    });
    return;
  }

  // Delete one file, or a whole selection, within one shelf.
  if (pathname === "/api/docs/delete" && req.method === "POST") {
    readBody(req, res, 256 * 1024, (raw) => {
      const payload = parseJson(raw);
      const store = readDocsStore();
      const shelf = payload ? shelffById(store, payload.shelf) : null;
      if (!payload || !shelf) {
        reply(res, 400, JSON.stringify({ ok: false, error: "Unknown shelf" }));
        return;
      }
      const requested = Array.isArray(payload.names) ? payload.names : [payload.name];
      const names = requested.map(safeDocName).filter(Boolean);
      if (!names.length) {
        reply(res, 400, JSON.stringify({ ok: false, error: "Bad file name" }));
        return;
      }
      const dir = docsDirFor(shelf.id);
      Promise.all(names.map((name) => new Promise((resolve) => {
        fs.unlink(path.join(dir, name), (error) => resolve({ name, ok: !error || error.code === "ENOENT" }));
      }))).then((results) => {
        reply(res, 200, JSON.stringify({ ok: true, deleted: results.filter((r) => r.ok).map((r) => r.name) }));
      });
    });
    return;
  }

  // Stream one file for preview.
  if (pathname === "/api/docs/raw" && req.method === "GET") {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const store = readDocsStore();
    const shelf = shelffById(store, url.searchParams.get("shelf"));
    const name = safeDocName(url.searchParams.get("name"));
    if (!shelf || !name) {
      reply(res, 400, JSON.stringify({ ok: false, error: "Bad request" }));
      return;
    }
    const ext = path.extname(name).toLowerCase();
    if (!DOC_PREVIEW_EXT.has(ext)) {
      reply(res, 415, JSON.stringify({ ok: false, error: "Not previewable" }));
      return;
    }
    fs.readFile(path.join(docsDirFor(shelf.id), name), (error, data) => {
      if (error) {
        reply(res, error.code === "ENOENT" ? 404 : 500, JSON.stringify({ ok: false, error: "Not found" }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Content-Length": data.length,
        "Cache-Control": "no-cache",
      });
      res.end(data);
    });
    return;
  }

  // Insert an image into a note. Raw body; shelf in a header, kind in
  // Content-Type — the same shape as the work-log image upload.
  if (pathname === "/api/docs/image" && req.method === "POST") {
    const store = readDocsStore();
    const shelf = shelffById(store, req.headers["x-doc-shelf"]);
    if (!shelf) {
      reply(res, 400, JSON.stringify({ ok: false, error: "Unknown shelf" }));
      return;
    }
    const contentType = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const ext = DOC_IMAGE_TYPES[contentType];
    if (!ext) {
      reply(res, 415, JSON.stringify({ ok: false, error: "Unsupported image type" }));
      return;
    }
    const name = "doc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
    const dir = docsImageDir(shelf.id);
    try { fs.mkdirSync(dir, { recursive: true }); }
    catch (error) { reply(res, 500, JSON.stringify({ ok: false, error: error.message })); return; }
    readBody(req, res, MAX_DOC_SIZE, (data) => {
      fs.writeFile(path.join(dir, name), data, (error) => {
        if (error) {
          reply(res, 500, JSON.stringify({ ok: false, error: "Write failed" }));
          return;
        }
        reply(res, 200, JSON.stringify({
          ok: true, name,
          url: "/api/docs/image?shelf=" + encodeURIComponent(shelf.id) + "&name=" + encodeURIComponent(name),
        }));
      });
    });
    return;
  }

  // Serve an inserted image.
  if (pathname === "/api/docs/image" && req.method === "GET") {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const store = readDocsStore();
    const shelf = shelffById(store, url.searchParams.get("shelf"));
    const name = safeDocName(url.searchParams.get("name"));
    if (!shelf || !name || !/^image\//.test(MIME[path.extname(name).toLowerCase()] || "")) {
      reply(res, 400, JSON.stringify({ ok: false, error: "Bad request" }));
      return;
    }
    fs.readFile(path.join(docsImageDir(shelf.id), name), (error, data) => {
      if (error) {
        reply(res, error.code === "ENOENT" ? 404 : 500, JSON.stringify({ ok: false, error: "Not found" }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(name).toLowerCase()],
        "Content-Length": data.length,
        "Cache-Control": "no-cache",
      });
      res.end(data);
    });
    return;
  }

  // ── Static files ────────────────────────────────────────
  // Default to index.html; bare page names resolve to their own file
  let filePath = pathname === "/" ? "/index.html" : pathname;
  if (pathname === "/admin" || pathname === "/admin/") filePath = "/admin.html";
  if (pathname === "/docs" || pathname === "/docs/") filePath = "/docs.html";
  serveStatic(filePath, res);
}

// ── Start ────────────────────────────────────────────────────

const server = http.createServer(handleRequest);

function start(port) {
  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`Daily Studio running at ${url}`);
    console.log(`Data file: ${DATA_FILE}`);
    console.log("Press Ctrl+C to stop.");

    // Try to open the browser automatically
    const { exec } = require("child_process");
    const cmd = process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
    exec(cmd, () => {});
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(`Port ${port} is in use, trying ${port + 1}…`);
      server.close();
      start(port + 1);
    } else {
      throw err;
    }
  });
}

start(PORT);
