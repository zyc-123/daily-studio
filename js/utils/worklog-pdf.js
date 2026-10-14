/**
 * WorkLogPdf — a self-contained PDF export engine for Work Log documents.
 *
 * Generates a real PDF file in the browser without relying on `window.print()`:
 * a hand-written PDF writer (objects, xref table, Flate-compressed streams), a
 * layout engine with CJK-aware line wrapping and page breaks, a parser for the
 * Work Log rich-text syntax (headings, bold/italic, inline code, fenced code,
 * quotes, bullet/numbered lists, links, pasted images, task/resource references
 * and issue blocks), and a TrueType subsetter.
 *
 * Text is drawn with an embedded subset of a system CJK font (served by the
 * local server at /api/worklog-font), so Chinese, Latin and code all render
 * identically in every viewer — including pdf.js-based ones. Glyph widths are
 * read from the font's `hmtx` table and written into the PDF `/W` array, which
 * makes layout exact rather than estimated. Fake bold uses the text stroke
 * rendering mode; italic uses a sheared text matrix; Courier (a base-14 font)
 * draws code. If no system font is available the exporter falls back to the
 * predefined Adobe-GB1 font STSong-Light. Pasted JPEG images are embedded
 * directly (DCTDecode); PNG images are inflated and unfiltered in JavaScript
 * and embedded as Flate-compressed RGB.
 */
(function (global) {
  "use strict";

  /* ── Page geometry (A4) ─────────────────────────────────────────────── */
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const MARGIN = 51.02; // 18mm, mirrors the previous print stylesheet
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const CONTENT_BOTTOM = PAGE_H - MARGIN;
  const CONTENT_H = CONTENT_BOTTOM - MARGIN;

  /* ── Typography ───────────────────────────────────────────────────────
   * Every value mirrors the preview stylesheet (css/styles.css) with CSS
   * pixels converted to points at 96dpi, so the exported page measures the
   * same as the on-screen preview.
   */
  const BODY_SIZE = 10.8;        // .9rem = 14.4px
  const BODY_LH = 1.7;
  const HEADING_SIZE = { 1: 16.8, 2: 13.8, 3: 12 }; // 1.4rem / 1.15rem / 1rem
  const HEADING_LH = 1.25;
  const HEADING_MARGIN = [1, 0.5]; // `margin: 1em 0 .5em`
  const META_SIZE = 9;
  const QUOTE_INDENT = 9;        // padding-left: 12px
  const QUOTE_BORDER = 2.25;     // border-left: 3px
  const LIST_INDENT = 13.5;      // margin-left: 1.25em
  const LIST_MARKER = 9;         // distance from the item text to the bullet
  const CODE_PAD = 9;            // pre padding: 12px
  const CODE_BORDER = 3;         // pre border-radius: 4px
  const CHIP_LABEL_SIZE = 9.18;  // .85em of 14.4px = 12.24px
  const CHIP_SMALL_SIZE = 6.61;  // .72em of 12.24px = 8.81px
  const CHIP_LINE = 1.35;        // font: 600 .85em/1.35
  const CHIP_PAD_X = 5.25;       // padding: 3px 7px
  const CHIP_PAD_Y = 2.25;
  const CHIP_LEAD = 0.75;        // the preview's flex column adds ~1px around its lines
  const CHIP_MAX = 330;          // max-width: min(100%, 440px)
  const CHIP_H = CHIP_PAD_Y * 2 + CHIP_LEAD * 2 + (CHIP_LABEL_SIZE + CHIP_SMALL_SIZE) * CHIP_LINE;
  const ISSUE_PAD_Y = 6;             // header padding: 8px 12px
  const ISSUE_PAD_X = 9;
  const ISSUE_LABEL_SIZE = 8.4;      // .7rem = 11.2px
  const ISSUE_LABEL_LINE = 1.7;      // inherits the preview's line-height
  const ISSUE_LABEL_BOX = ISSUE_LABEL_SIZE * ISSUE_LABEL_LINE; // 19px line box
  const ISSUE_STATE_SIZE = 8.4;      // .7rem
  const ISSUE_STATE_LINE = 1.34;     // the button's default `normal` line box
  const ISSUE_STATE_PAD_X = 6;       // state padding: 3px 8px
  const ISSUE_STATE_PAD_Y = 2.25;
  const ISSUE_STATE_BORDER = 0.75;   // border: 1px
  const ISSUE_STATE_H = (ISSUE_STATE_PAD_Y + ISSUE_STATE_BORDER) * 2 + ISSUE_STATE_SIZE * ISSUE_STATE_LINE; // 23px
  // The header is a centred flex row, so it is as tall as its tallest item.
  const ISSUE_HEADER_H = ISSUE_PAD_Y * 2 + Math.max(ISSUE_LABEL_BOX, ISSUE_STATE_H);
  const ISSUE_BODY_PAD = 7.5;        // content padding: 10px 12px
  const ISSUE_BODY_PAD_X = 9;
  const ISSUE_BORDER = 0.75;         // border: 1px
  const ISSUE_ACCENT_W = 2.25;       // border-left: 3px
  const EMPTY_SIZE = 9;              // .worklog-issues-empty { font-size: .75rem }
  const IMAGE_BORDER = 0.75;         // .worklog-image { border: 1px }
  const IMAGE_RADIUS = 3;            // border-radius: 4px
  const IMAGE_CAPTION_PAD_Y = 6;     // summary { padding: 8px 12px }
  const IMAGE_CAPTION_PAD_X = 9;
  const IMAGE_CAPTION_MAX_LINES = 3;
  const IMAGE_FAIL_HEIGHT = 60;      // placeholder height when a file is missing
  const FOOTER_SIZE = 7.5;

  /* ── Colors ───────────────────────────────────────────────────────────
   * Taken from the running theme, so the page uses the same accent and
   * surface colours the preview is showing.
   */
  const hexColor = (hex) => [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
  const mixColors = (a, b, ratio) => a.map((value, index) => value * ratio + b[index] * (1 - ratio));
  const DEFAULT_PALETTE = {
    bg: "#f1f5f9",
    surface: "#ffffff",
    surfaceHover: "#f8fafc",
    border: "#e2e8f0",
    textPrimary: "#1e293b",
    textSecondary: "#64748b",
    textMuted: "#94a3b8",
    accent: "#0d9488",
    accentSoft: "#f0fdfa",
  };
  let C = null;

  function buildColors(palette) {
    const p = { ...DEFAULT_PALETTE, ...(palette || {}) };
    return {
      surface: hexColor(p.surface),
      text: hexColor(p.textPrimary),
      muted: hexColor(p.textSecondary),
      faint: hexColor(p.textMuted),
      accent: hexColor(p.accent),
      quote: hexColor(p.textSecondary),
      quoteBorder: hexColor(p.accent),
      codeBg: hexColor(p.bg),
      border: hexColor(p.border),
      chipBg: hexColor(p.surfaceHover),
      imageCaptionBg: hexColor(p.surfaceHover),
      taskChipBg: hexColor(p.accentSoft),
      taskChipBorder: mixColors(hexColor(p.accent), hexColor(p.border), 0.35), // color-mix(accent 35%, border)
      taskChipText: hexColor(p.accent),
      issueAccent: hexColor("#d97706"),
      issueHeaderBg: hexColor(p.surfaceHover),
      // Links and rules have no CSS rule, so the preview shows the browser defaults.
      link: hexColor("#0000ee"),
      hr: hexColor("#c0c0c0"),
      issueOpen: { border: hexColor("#f2c879"), bg: hexColor("#fff7e6"), text: hexColor("#8a4b08") },
      issueDone: { border: hexColor("#a7d9bc"), bg: hexColor("#eaf7ef"), text: hexColor("#17633a") },
    };
  }

  const SONG = "song";
  const MONO = "mono";
  const ASCENT = 0.86;
  const DESCENT = 0.14;

  /* Font subsets for the document being laid out, keyed by role and style
   * (see loadExportFonts). Null when the embedded fonts are unavailable, in
   * which case the predefined song font is used instead. */
  let SUBSETS = null;

  /* ── Character metrics ────────────────────────────────────────────────
   * Each glyph is drawn with the face the browser itself would pick: the UI
   * font (Segoe UI) or code font (Consolas) for the characters they cover,
   * then the CJK font for everything else — the preview's font stack
   * resolution. Advances come from the chosen face's `hmtx` table and are the
   * same numbers written into the PDF `/W` array, so layout is exact.
   */
  const isWide = (ch) => ch.charCodeAt(0) > 0xff;

  const FACE_ORDER = {
    boldItalic: ["boldItalic", "bold", "italic", "regular"],
    bold: ["bold", "semibold", "regular"],
    semibold: ["semibold", "bold", "regular"],
    italic: ["italic", "regular"],
    regular: ["regular"],
  };

  /* Weight a style asks for: 700 for `**strong**` and headings, 600 for the
   * chip labels and issue badges whose CSS says `font-weight: 600`. The
   * browser resolves 600 to the Semibold face where the family has one. */
  function weightOf(style) {
    return style.weight || (style.bold ? 700 : 400);
  }

  function faceKeyOf(style) {
    const weight = weightOf(style);
    if (style.italic) return weight >= 500 ? "boldItalic" : "italic";
    if (weight >= 700) return "bold";
    if (weight >= 500) return "semibold";
    return "regular";
  }

  /* Picks the face for one character, plus whether the glyph still needs
   * synthetic bold or a slant (the preview's oblique fallback for CJK). */
  function chooseFace(ch, style) {
    const weight = weightOf(style);
    if (!SUBSETS) {
      // No embedded fonts: the predefined song font covers wide characters
      // and base-14 Courier covers code, exactly as before.
      return {
        subset: null,
        font: style.font === MONO && !isWide(ch) ? MONO : SONG,
        shear: Boolean(style.italic),
        pseudoBold: weight >= 500,
      };
    }
    const codePoint = ch.codePointAt(0);
    const roles = style.font === MONO ? ["mono", "cjk"] : ["ui", "cjk"];
    for (const role of roles) {
      for (const key of FACE_ORDER[faceKeyOf(style)]) {
        const subset = SUBSETS[role][key];
        if (subset && subset.hasGlyph(codePoint)) {
          const boldFace = key === "bold" || key === "boldItalic";
          const mediumFace = key === "semibold";
          return {
            subset,
            font: style.font,
            shear: Boolean(style.italic) && key.indexOf("italic") === -1,
            // Stroke the outline only when no face of the right weight exists.
            pseudoBold: (weight >= 700 && !boldFace) || (weight >= 500 && !boldFace && !mediumFace),
          };
        }
      }
    }
    const fallback = (SUBSETS.ui && SUBSETS.ui.regular) || (SUBSETS.cjk && SUBSETS.cjk.regular) || null;
    return { subset: fallback, font: style.font, shear: Boolean(style.italic), pseudoBold: weight >= 500 };
  }

  function charW(ch, style) {
    const face = chooseFace(ch, style);
    if (face.subset) return face.subset.widthOf(ch.codePointAt(0)) * style.size;
    if (face.font === MONO) return style.size * 0.6;
    return isWide(ch) ? style.size : style.size * 0.5;
  }

  function textW(text, style) {
    let width = 0;
    for (const ch of text) width += charW(ch, style);
    return width;
  }

  /* Replaces characters the embedded/fallback font cannot represent (control
   * codes and code points outside the BMP, e.g. emoji) so measurement and
   * emission always agree. Tabs become two spaces; newlines are kept because
   * they mark line breaks inside a paragraph. */
  function sanitizeText(text) {
    let out = "";
    for (const ch of text) {
      const code = ch.codePointAt(0);
      if (ch === "\t") out += "  ";
      else if (ch === "\n") out += ch;
      else if (code > 0xffff || code < 0x20) out += "?";
      else out += ch;
    }
    return out;
  }

  /* Truncates to a width, using the same face the text will be drawn with —
   * a bold run is wider than a regular one, so the style has to be passed in. */
  function truncateText(text, style, maxWidth) {
    let width = 0;
    let end = 0;
    for (const ch of text) {
      const advance = charW(ch, style);
      if (width + advance + style.size > maxWidth) break;
      width += advance;
      end += 1;
    }
    return end < text.length ? `${text.slice(0, end)}…` : text;
  }

  const fmt = (value) => String(parseFloat(value.toFixed(2)));

  /* ── Low-level PDF writer ───────────────────────────────────────────── */
  class PdfWriter {
    constructor() {
      this.objects = []; // object number = index + 1
    }

    addObject(chunks) {
      this.objects.push(concatBytes(chunks));
      return this.objects.length;
    }

    async addStream(dictEntries, data) {
      const compressed = await deflate(data);
      const body = compressed || data;
      const dict = [...dictEntries, ...(compressed ? ["/Filter /FlateDecode"] : []), `/Length ${body.length}`].join(" ");
      return this.addObject([`<< ${dict} >>\nstream\n`, body, `\nendstream`]);
    }

    async build() {
      const chunks = [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
      const offsets = [];
      for (let i = 0; i < this.objects.length; i++) {
        offsets.push(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
        chunks.push(enc(`${i + 1} 0 obj\n`), this.objects[i], enc("\nendobj\n"));
      }
      const xrefPos = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      chunks.push(enc(`xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`));
      for (const offset of offsets) chunks.push(enc(`${String(offset).padStart(10, "0")} 00000 n \n`));
      chunks.push(enc(`trailer\n<< /Size ${this.objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`));
      return concatBytes(chunks);
    }
  }

  function enc(text) {
    return new TextEncoder().encode(text);
  }

  function concatBytes(chunks) {
    const parts = chunks.map((chunk) => (typeof chunk === "string" ? enc(chunk) : chunk));
    const total = parts.reduce((sum, chunk) => sum + (chunk ? chunk.length : 0), 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of parts) {
      if (!chunk) continue;
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  async function deflate(data) {
    if (typeof CompressionStream !== "function") return null;
    try {
      const stream = new CompressionStream("deflate");
      const writer = stream.writable.getWriter();
      writer.write(data);
      writer.close();
      return new Uint8Array(await new Response(stream.readable).arrayBuffer());
    } catch {
      return null;
    }
  }

  async function inflate(data) {
    if (typeof DecompressionStream !== "function") return null;
    try {
      const stream = new DecompressionStream("deflate");
      const writer = stream.writable.getWriter();
      writer.write(data);
      writer.close();
      return new Uint8Array(await new Response(stream.readable).arrayBuffer());
    } catch {
      return null;
    }
  }

  /* ── TrueType parsing and subsetting ─────────────────────────────────
   * Enough of the sfnt format to embed a document-specific subset: cmap for
   * code point → glyph, loca/glyf for outlines (composites included and
   * renumbered), hmtx for advances. Tables the PDF viewer does not need
   * (cmap, OS/2, hinting, names) are dropped or synthesized.
   */
  const u16 = (bytes, offset) => (bytes[offset] << 8) | bytes[offset + 1];
  const i16 = (bytes, offset) => ((bytes[offset] << 8) | bytes[offset + 1]) << 16 >> 16;
  const u32 = (bytes, offset) => ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  const tag = (bytes, offset) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

  class SfntFont {
    constructor(bytes) {
      this.bytes = bytes;
      let base = 0;
      if (tag(bytes, 0) === "ttcf") {
        const version = u32(bytes, 4);
        if (version !== 0x00010000 && version !== 0x00020000) throw new Error("Unsupported font collection");
        base = u32(bytes, 12); // tables of the first font in the collection
      }
      const numTables = u16(bytes, base + 4);
      this.tables = new Map();
      for (let i = 0; i < numTables; i++) {
        const entry = base + 12 + i * 16;
        this.tables.set(tag(bytes, entry), { offset: u32(bytes, entry + 8), length: u32(bytes, entry + 12) });
      }
      for (const required of ["head", "hhea", "maxp", "hmtx", "loca", "glyf"]) {
        if (!this.tables.has(required)) throw new Error(`Font is missing the ${required} table`);
      }
      const head = this.tables.get("head");
      this.unitsPerEm = u16(bytes, head.offset + 18) || 1000;
      this.locFormat = i16(bytes, head.offset + 50);
      this.bbox = [
        i16(bytes, head.offset + 36), i16(bytes, head.offset + 38),
        i16(bytes, head.offset + 40), i16(bytes, head.offset + 42),
      ];
      const hhea = this.tables.get("hhea");
      this.ascender = i16(bytes, hhea.offset + 4);
      this.descender = i16(bytes, hhea.offset + 6);
      this.numberOfHMetrics = u16(bytes, hhea.offset + 34);
      this.numGlyphs = u16(bytes, this.tables.get("maxp").offset + 4);

      const os2 = this.tables.get("OS/2");
      this.fsType = os2 && os2.length >= 10 ? u16(bytes, os2.offset + 8) : 0;
      this.typographicAscender = os2 && os2.length >= 72 ? i16(bytes, os2.offset + 68) : this.ascender;
      this.typographicDescender = os2 && os2.length >= 72 ? i16(bytes, os2.offset + 70) : this.descender;
      this.parseCmap();
    }

    /* TrueType embedding is only permitted for fsType 0 (installable) and
     * fsType 8 (editable) per the OS/2 embedding flags. */
    get embeddable() {
      return (this.fsType & 0x0002) === 0 && (this.fsType & 0x0004) === 0 && (this.fsType & 0x0200) === 0;
    }

    parseCmap() {
      const table = this.tables.get("cmap");
      this.cmap12 = null;
      this.cmap4 = null;
      if (!table) return;
      const { bytes } = this;
      const numTables = u16(bytes, table.offset + 2);
      let best = null;
      for (let i = 0; i < numTables; i++) {
        const entry = table.offset + 4 + i * 8;
        const platform = u16(bytes, entry);
        const encoding = u16(bytes, entry + 2);
        const subtable = table.offset + u32(bytes, entry + 4);
        const format = u16(bytes, subtable);
        const rank = (platform === 3 && encoding === 10) ? 4
          : (platform === 0 && format === 12) ? 3
          : (platform === 3 && encoding === 1) ? 2
          : (platform === 0 && format === 4) ? 1 : 0;
        if (rank > 0 && (!best || rank > best.rank)) best = { rank, subtable, format };
      }
      if (!best) return;
      if (best.format === 12) {
        const groups = [];
        const count = u32(this.bytes, best.subtable + 12);
        for (let i = 0; i < count; i++) {
          const group = best.subtable + 16 + i * 12;
          groups.push([u32(this.bytes, group), u32(this.bytes, group + 4), u32(this.bytes, group + 8)]);
        }
        this.cmap12 = groups;
      } else if (best.format === 4) {
        const base = best.subtable;
        const segCount = u16(this.bytes, base + 6) / 2;
        const endBase = base + 14;
        const startBase = endBase + segCount * 2 + 2;
        const deltaBase = startBase + segCount * 2;
        const rangeBase = deltaBase + segCount * 2;
        const records = [];
        for (let i = 0; i < segCount; i++) {
          const start = u16(this.bytes, startBase + i * 2);
          const end = u16(this.bytes, endBase + i * 2);
          if (start > end || start === 0xffff) continue;
          records.push({
            start,
            end,
            delta: i16(this.bytes, deltaBase + i * 2),
            rangeOffset: u16(this.bytes, rangeBase + i * 2),
            rangeAddress: rangeBase + i * 2,
          });
        }
        this.cmap4 = records;
      }
    }

    glyphFor(codePoint) {
      if (this.cmap12) {
        let low = 0;
        let high = this.cmap12.length - 1;
        while (low <= high) {
          const mid = (low + high) >> 1;
          const [start, end, startGlyph] = this.cmap12[mid];
          if (codePoint < start) high = mid - 1;
          else if (codePoint > end) low = mid + 1;
          else return startGlyph + (codePoint - start);
        }
        return 0;
      }
      if (!this.cmap4 || codePoint > 0xffff) return 0;
      for (const record of this.cmap4) {
        if (codePoint < record.start || codePoint > record.end) continue;
        if (record.rangeOffset === 0) return (codePoint + record.delta) & 0xffff;
        const address = record.rangeAddress + record.rangeOffset + (codePoint - record.start) * 2;
        const glyph = u16(this.bytes, address);
        return glyph === 0 ? 0 : (glyph + record.delta) & 0xffff;
      }
      return 0;
    }

    loca(glyphIndex) {
      const { offset } = this.tables.get("loca");
      if (this.locFormat === 0) return u16(this.bytes, offset + glyphIndex * 2) * 2;
      return u32(this.bytes, offset + glyphIndex * 4);
    }

    glyphData(glyphIndex) {
      const start = this.loca(glyphIndex);
      const end = this.loca(glyphIndex + 1);
      const glyfOffset = this.tables.get("glyf").offset;
      return this.bytes.subarray(glyfOffset + start, glyfOffset + end);
    }

    glyphAdvance(glyphIndex) {
      const { offset } = this.tables.get("hmtx");
      if (glyphIndex < this.numberOfHMetrics) return u16(this.bytes, offset + glyphIndex * 4);
      return u16(this.bytes, offset + (this.numberOfHMetrics - 1) * 4);
    }

    /* Glyphs referenced by a composite glyph, so subsets keep their parts. */
    componentsOf(glyphIndex) {
      const data = this.glyphData(glyphIndex);
      if (data.length < 10 || i16(data, 0) >= 0) return [];
      const components = [];
      let offset = 10;
      for (;;) {
        const flags = u16(data, offset);
        components.push(u16(data, offset + 2));
        offset += 4 + (flags & 0x0001 ? 4 : 2);
        if (flags & 0x0008) offset += 2;
        else if (flags & 0x0040) offset += 4;
        else if (flags & 0x0080) offset += 8;
        if (!(flags & 0x0020)) break;
      }
      return components;
    }
  }

  function writeU16(bytes, offset, value) {
    bytes[offset] = (value >> 8) & 0xff;
    bytes[offset + 1] = value & 0xff;
  }

  function writeU32(bytes, offset, value) {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  }

  /* Builds a subset font containing only the glyphs the document uses, with
   * dense glyph indices (CID = glyph index). Returns null if the font cannot
   * be subset (unsupported embedding flags or no usable glyphs). */
  /* `metricsOnly` skips building the font file and the glyph data, which is
   * all the page-break measurement needs and much cheaper to run. */
  function buildSubset(font, codePoints, name, metricsOnly = false) {
    if (!font.embeddable) return null;
    const glyphOf = new Map(); // code point → glyph index
    const fallbackGlyph = font.glyphFor(0xfffd) || font.glyphFor(0x3f) || 0;
    const used = new Set([0, fallbackGlyph]);
    for (const codePoint of codePoints) {
      const glyph = font.glyphFor(codePoint) || fallbackGlyph;
      glyphOf.set(codePoint, glyph);
      used.add(glyph);
    }
    // Composite glyphs need their components present in the subset.
    const queue = [...used];
    while (queue.length) {
      for (const component of font.componentsOf(queue.pop())) {
        if (!used.has(component)) {
          used.add(component);
          queue.push(component);
        }
      }
    }

    const glyphList = [...used].sort((a, b) => a - b);
    const denseIndex = new Map();
    glyphList.forEach((glyph, index) => denseIndex.set(glyph, index));

    const widthOf = new Map(); // dense glyph index → width in 1000ths
    glyphList.forEach((glyph, index) => {
      widthOf.set(index, Math.round((font.glyphAdvance(glyph) * 1000) / font.unitsPerEm));
    });
    const cidForCode = (codePoint) => {
      const glyph = glyphOf.get(codePoint);
      if (glyph === undefined) return denseIndex.get(fallbackGlyph) || 0;
      const cid = denseIndex.get(glyph);
      return cid === undefined ? denseIndex.get(fallbackGlyph) || 0 : cid;
    };
    const width1000 = (cid) => widthOf.get(cid) || 1000;
    const metrics = {
      unitsPerEm: font.unitsPerEm,
      glyphCount: glyphList.length,
      ascender: font.typographicAscender || font.ascender,
      descender: font.typographicDescender || font.descender,
      bbox: font.bbox,
      widthOf(codePoint) {
        return width1000(cidForCode(codePoint)) / 1000;
      },
      hasGlyph(codePoint) {
        return font.glyphFor(codePoint) !== 0;
      },
    };
    if (metricsOnly) return metrics;

    // glyf + loca (long format, 4-byte aligned).
    const glyfParts = [];
    const loca = new Uint32Array(glyphList.length + 1);
    let glyfLength = 0;
    glyphList.forEach((glyph, index) => {
      loca[index] = glyfLength;
      let data = font.glyphData(glyph);
      if (!data.length) return;
      const copy = new Uint8Array(data.length);
      copy.set(data);
      if (i16(copy, 0) < 0) {
        // Composite: renumber the component glyph indices in place.
        let offset = 10;
        for (;;) {
          const flags = u16(copy, offset);
          const component = u16(copy, offset + 2);
          const mapped = denseIndex.get(component);
          writeU16(copy, offset + 2, mapped === undefined ? 0 : mapped);
          offset += 4 + (flags & 0x0001 ? 4 : 2);
          if (flags & 0x0008) offset += 2;
          else if (flags & 0x0040) offset += 4;
          else if (flags & 0x0080) offset += 8;
          if (!(flags & 0x0020)) break;
        }
      }
      const padded = (copy.length + 3) & ~3;
      const block = new Uint8Array(padded);
      block.set(copy);
      glyfParts.push(block);
      glyfLength += padded;
    });
    loca[glyphList.length] = glyfLength;

    const locaBytes = new Uint8Array(loca.length * 4);
    loca.forEach((value, index) => writeU32(locaBytes, index * 4, value));
    const glyfBytes = concatBytes(glyfParts);

    // hmtx: every subset glyph keeps a full advance/lsb record.
    const hmtxBytes = new Uint8Array(glyphList.length * 4);
    glyphList.forEach((glyph, index) => {
      writeU16(hmtxBytes, index * 4, font.glyphAdvance(glyph));
      writeU16(hmtxBytes, index * 4 + 2, 0);
    });

    // head / hhea / maxp / post rebuilt from the source font.
    const head = new Uint8Array(font.bytes.subarray(font.tables.get("head").offset, font.tables.get("head").offset + 54));
    writeU32(head, 8, 0); // checkSumAdjustment, patched after assembly
    writeU16(head, 50, 1); // long loca

    const hhea = new Uint8Array(font.bytes.subarray(font.tables.get("hhea").offset, font.tables.get("hhea").offset + 36));
    writeU16(hhea, 34, glyphList.length);

    const maxpOffset = font.tables.get("maxp").offset;
    const maxp = new Uint8Array(font.bytes.subarray(maxpOffset, maxpOffset + Math.max(6, font.tables.get("maxp").length)));
    writeU16(maxp, 4, glyphList.length);

    const post = new Uint8Array(32);
    writeU32(post, 0, 0x00030000); // version 3.0: no glyph names

    const tables = [
      ["glyf", glyfBytes],
      ["head", head],
      ["hhea", hhea],
      ["hmtx", hmtxBytes],
      ["loca", locaBytes],
      ["maxp", maxp],
      ["post", post],
    ];
    // Keep the hinting tables: glyph instructions index into them.
    for (const name of ["cvt ", "fpgm", "prep"]) {
      const table = font.tables.get(name);
      if (table) tables.push([name, font.bytes.subarray(table.offset, table.offset + table.length)]);
    }
    tables.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    const numTables = tables.length;
    const directorySize = 12 + numTables * 16;
    let total = directorySize;
    for (const [, data] of tables) total += (data.length + 3) & ~3;
    const file = new Uint8Array(total);
    writeU32(file, 0, 0x00010000);
    writeU16(file, 4, numTables);
    const entrySelector = Math.floor(Math.log2(numTables));
    writeU16(file, 6, 16 * 2 ** entrySelector);
    writeU16(file, 8, entrySelector);
    writeU16(file, 10, numTables * 16 - 16 * 2 ** entrySelector);

    let offset = directorySize;
    let headFileOffset = 0;
    tables.forEach(([name, data], index) => {
      const entry = 12 + index * 16;
      for (let i = 0; i < 4; i++) file[entry + i] = name.charCodeAt(i);
      let checksum = 0;
      for (let i = 0; i < data.length; i += 4) {
        const word = ((data[i] || 0) << 24) | ((data[i + 1] || 0) << 16) | ((data[i + 2] || 0) << 8) | (data[i + 3] || 0);
        checksum = (checksum + (word >>> 0)) >>> 0;
      }
      writeU32(file, entry + 4, checksum);
      writeU32(file, entry + 8, offset);
      writeU32(file, entry + 12, data.length);
      file.set(data, offset);
      if (name === "head") headFileOffset = offset;
      offset += (data.length + 3) & ~3;
    });

    // head.checkSumAdjustment = 0xB1B0AFBA − checksum(whole file)
    let fileChecksum = 0;
    for (let i = 0; i < file.length; i += 4) {
      const word = ((file[i] || 0) << 24) | ((file[i + 1] || 0) << 16) | ((file[i + 2] || 0) << 8) | (file[i + 3] || 0);
      fileChecksum = (fileChecksum + (word >>> 0)) >>> 0;
    }
    writeU32(file, headFileOffset + 8, (0xb1b0afba - fileChecksum) >>> 0);

    // CID → Unicode for text extraction. A glyph shared by several code points
    // (the fallback glyph) keeps the first character that maps to it.
    const unicodeOfCid = new Map();
    for (const [codePoint, glyph] of glyphOf) {
      const cid = denseIndex.get(glyph);
      if (cid !== undefined && !unicodeOfCid.has(cid)) unicodeOfCid.set(cid, codePoint);
    }

    return {
      ...metrics,
      file,
      name,
      widths: [...widthOf.entries()],
      toUnicodePairs: [...unicodeOfCid.entries()].sort((a, b) => a[0] - b[0]),
      cidForCode,
      /* Width of the glyph a character will be drawn with, in ems — the same
       * value the viewer reads from /W, so layout matches rendering exactly. */
      widthOf: metrics.widthOf,
      hasGlyph: metrics.hasGlyph,
    };
  }

  /* Text as CIDs: with the subset embedded, code = glyph index = CID. */
  function cidHex(text, subset) {
    let out = "";
    for (const ch of text) {
      const cid = subset.cidForCode(ch.codePointAt(0)) || 0;
      out += cid.toString(16).padStart(4, "0");
    }
    return out;
  }

  /* ── Font loading ───────────────────────────────────────────────────
   * The preview resolves its stack to the UI font for Latin, the code font
   * for monospaced text and the system CJK font for everything else. Those
   * faces are fetched (once per session) from the local server and subset per
   * document so the PDF shows the same typefaces as the preview.
   */
  const FACE_KEYS = ["regular", "semibold", "bold", "italic", "boldItalic"];
  let facesPromise = null;

  /* A server that predates the font route answers with its single-page
   * fallback (index.html, HTTP 200), so the payload is checked for an sfnt
   * signature rather than trusting the status code. */
  function looksLikeFont(bytes) {
    if (bytes.length < 12) return false;
    const signature = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    return signature === 0x00010000 || signature === 0x74727565 || signature === 0x4f54544f || signature === 0x74746366;
  }

  async function loadExportFonts(needsCjk) {
    if (!facesPromise) {
      facesPromise = (async () => {
        const roles = { ui: FACE_KEYS.slice(), mono: FACE_KEYS.slice(), cjk: ["regular", "bold"] };
        const faces = { ui: {}, mono: {}, cjk: {} };
        const requests = [];
        for (const role of Object.keys(roles)) {
          for (const style of roles[role]) requests.push([role, style]);
        }
        await Promise.all(requests.map(async ([role, style]) => {
          try {
            const response = await fetch(`/api/worklog-font?role=${role}&style=${style}`);
            if (!response.ok) return;
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (!looksLikeFont(bytes)) return; // out-of-date server, not a font
            faces[role][style] = new SfntFont(bytes);
          } catch { /* that face is not installed on this machine */ }
        }));
        return faces;
      })();
    }
    const faces = await facesPromise;
    // CJK faces are only carried when the document actually uses them; they
    // are the largest files and every export would pay for them.
    return needsCjk ? faces : { ui: faces.ui, mono: faces.mono, cjk: {} };
  }

  /* Every face the document will draw with, as ready-to-embed subsets. */
  function buildSubsets(faces, codePoints, metricsOnly = false) {
    const subsets = { ui: {}, mono: {}, cjk: {} };
    let index = 0;
    for (const role of ["ui", "mono", "cjk"]) {
      for (const style of FACE_KEYS) {
        const font = faces[role] && faces[role][style];
        if (!font) continue;
        const subset = buildSubset(font, codePoints, `F${index}`, metricsOnly);
        if (subset) {
          subsets[role][style] = subset;
          index += 1;
        }
      }
    }
    return index ? subsets : null;
  }

  /* ── Parser ───────────────────────────────────────────────────────────
   * Recognizes the same source syntax as the preview renderer
   * (WorkLog.#toMarkdown): headings, `> ` quotes, `- ` and `1. ` lists,
   * `---` rules, ``` fenced code, `:::issue ID State ... :::end ID` blocks,
   * and inline `**bold**`, `*italic*`, `` `code` ``, links, pasted images
   * (`![alt](/assets/worklog-images/name.png){width=50%}`), resource
   * references (`[[resource:url:...|label]]`) and task references
   * (`[[task:calendar:date:id|fallback]]`, `[[task:longterm:id|fallback]]`).
   */
  const INLINE_PATTERN = [
    /!\[([^\]]*)\]\((\/assets\/worklog-images\/[a-zA-Z0-9._-]+)\)(?:\{width=(\d{1,3})%\})?/.source,
    /\[\[resource:(url|file):([^|\]]+)\|([^\]]+)\]\]/.source,
    /\[\[task:calendar:(\d{4}-\d{2}-\d{2}):(\d+)\|([^\]]+)\]\]/.source,
    /\[\[task:longterm:(\d+)\|([^\]]+)\]\]/.source,
    /`([^`]+)`/.source,
    /\*\*([^*]+)\*\*/.source,
    /\*([^*]+)\*/.source,
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.source,
  ].join("|");

  function parseDocument(source) {
    const imagePaths = new Set();
    const blocks = parseBlocks(String(source || "").replace(/\r\n?/g, "\n"), imagePaths);
    return { blocks, imagePaths };
  }

  function parseBlocks(text, imagePaths) {
    const lines = text.split("\n");
    const blocks = [];
    const paragraph = [];
    const flushParagraph = () => {
      if (!paragraph.length) return;
      const runs = parseInline(paragraph.join("\n"), imagePaths);
      paragraph.length = 0;
      // The preview lifts every image out of its paragraph into a titled box,
      // so the exporter does the same: text before and after stays its own
      // paragraph and the image becomes a block.
      let textRuns = [];
      const flushText = () => {
        if (textRuns.length) {
          blocks.push({ type: "paragraph", runs: textRuns });
          textRuns = [];
        }
      };
      for (const run of runs) {
        if (run.img) {
          flushText();
          blocks.push({ type: "image", image: run.img });
        } else {
          textRuns.push(run);
        }
      }
      flushText();
    };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const issue = /^:::issue ([a-zA-Z0-9_-]+) (Open|Completed)[ \t]*$/.exec(line);
      if (issue) {
        flushParagraph();
        const end = lines.findIndex((entry, index) => index > i && new RegExp(`^:::end ${issue[1]}[ \\t]*$`).test(entry));
        if (end === -1) {
          paragraph.push(line); // unterminated marker stays plain text
        } else {
          blocks.push({
            type: "issue",
            id: issue[1],
            state: issue[2],
            blocks: parseBlocks(lines.slice(i + 1, end).join("\n"), imagePaths),
          });
          i = end;
        }
        i += 1;
        continue;
      }
      // Fenced code mirrors the preview's /```([\s\S]*?)```/ regex: the text on
      // the opening fence (a language tag, usually) is part of the block.
      if (/^\s*```/.test(line)) {
        flushParagraph();
        const openAt = line.indexOf("```") + 3;
        const rest = line.slice(openAt);
        const sameLine = rest.indexOf("```");
        if (sameLine !== -1) {
          blocks.push({ type: "code", text: rest.slice(0, sameLine).replace(/^\n+|\n+$/g, "") });
          i += 1;
          continue;
        }
        let content = rest;
        let closed = false;
        let j = i + 1;
        while (j < lines.length) {
          const closeAt = lines[j].indexOf("```");
          if (closeAt !== -1) {
            content += `\n${lines[j].slice(0, closeAt)}`;
            closed = true;
            break;
          }
          content += `\n${lines[j]}`;
          j += 1;
        }
        if (!closed) { // an unterminated fence stays literal text, as in the preview
          paragraph.push(line);
          i += 1;
          continue;
        }
        blocks.push({ type: "code", text: content.replace(/^\n+|\n+$/g, "") });
        i = j + 1;
        continue;
      }
      if (/^### (.+)/.test(line)) { flushParagraph(); blocks.push({ type: "heading", level: 3, runs: parseInline(line.slice(4), imagePaths) }); i += 1; continue; }
      if (/^## (.+)/.test(line)) { flushParagraph(); blocks.push({ type: "heading", level: 2, runs: parseInline(line.slice(3), imagePaths) }); i += 1; continue; }
      if (/^# (.+)/.test(line)) { flushParagraph(); blocks.push({ type: "heading", level: 1, runs: parseInline(line.slice(2), imagePaths) }); i += 1; continue; }
      // The preview turns every `> ` line into its own quote block, and leaves
      // `1. ` lines as ordinary paragraph text, so the exporter does the same.
      if (/^> (.+)$/.test(line)) {
        flushParagraph();
        blocks.push({ type: "quote", runs: parseInline(line.slice(2), imagePaths) });
        i += 1;
        continue;
      }
      if (/^---[ \t]*$/.test(line)) { flushParagraph(); blocks.push({ type: "hr" }); i += 1; continue; }
      if (/^- (.+)$/.test(line)) {
        flushParagraph();
        const items = [];
        while (i < lines.length) {
          const match = /^- (.+)$/.exec(lines[i]);
          if (!match) break;
          items.push({ runs: parseInline(match[1], imagePaths) });
          i += 1;
        }
        blocks.push({ type: "list", items });
        continue;
      }
      if (!line.trim()) { flushParagraph(); i += 1; continue; }
      paragraph.push(line);
      i += 1;
    }
    flushParagraph();
    return blocks;
  }

  function parseInline(text, imagePaths) {
    const runs = [];
    let last = 0;
    const inlineRe = new RegExp(INLINE_PATTERN, "g"); // per-call: nested calls share no regex state
    let match;
    while ((match = inlineRe.exec(text))) {
      if (match.index > last) runs.push({ text: sanitizeText(text.slice(last, match.index)) });
      if (match[1] !== undefined) { // image
        const width = Math.max(10, Math.min(100, Number(match[3]) || 100));
        imagePaths.add(match[2]);
        runs.push({ img: { alt: match[1] || "Image", path: match[2], width } });
      } else if (match[4] !== undefined) { // resource reference
        let target = match[5];
        try { target = decodeURIComponent(target); } catch { /* Keep malformed references readable. */ }
        runs.push({ chip: { label: sanitizeText(match[6] || target), small: match[4] === "url" ? "URL" : /\.pdf$/i.test(target) ? "PDF" : "File", task: false } });
      } else if (match[7] !== undefined) { // calendar task reference
        runs.push({ chip: { label: sanitizeText(calendarTaskTitle(match[7], match[8], match[9])), small: match[7], task: true } });
      } else if (match[10] !== undefined) { // long-term task reference
        const resolved = longTermTaskInfo(match[10], match[11]);
        runs.push({ chip: { label: sanitizeText(resolved.title), small: resolved.date, task: true } });
      } else if (match[12] !== undefined) { // inline code
        runs.push({ code: sanitizeText(match[12]) });
      } else if (match[13] !== undefined) { // bold
        runs.push({ bold: parseInline(match[13], imagePaths) });
      } else if (match[14] !== undefined) { // italic
        runs.push({ italic: parseInline(match[14], imagePaths) });
      } else if (match[15] !== undefined) { // link
        runs.push({ link: parseInline(match[15], imagePaths) });
      }
      last = match.index + match[0].length;
    }
    if (last < text.length) runs.push({ text: sanitizeText(text.slice(last)) });
    return runs;
  }

  function calendarTaskTitle(date, id, fallback) {
    try {
      if (typeof CalendarStorage !== "undefined" && CalendarStorage.getTasks) {
        const task = CalendarStorage.getTasks(date).find((item) => item.id === Number(id));
        if (task) return task.abstract || "Untitled";
      }
    } catch { /* Storage unavailable. */ }
    return fallback;
  }

  function longTermTaskInfo(id, fallback) {
    try {
      if (typeof LongTermStorage !== "undefined" && LongTermStorage.loadAll) {
        const tasks = LongTermStorage.loadAll();
        const task = LongTermStorage.findNode(tasks, Number(id));
        const path = task ? LongTermStorage.getNodePath(tasks, Number(id)) : null;
        if (path) return { title: path, date: task.scheduledDate || "Not scheduled" };
      }
    } catch { /* Storage unavailable. */ }
    return { title: fallback, date: "Not scheduled" };
  }

  /* Every character that will be drawn by this module itself (issue chrome,
   * page numbers, image placeholders, list markers), so the subset covers
   * them even when the document never mentions them. */
  const RENDERER_LITERALS = "PROBLEMOpenCompletedNo details yet.[Image]Page …0123456789";

  /* Every character that will be drawn, so the subset covers all of them. */
  function collectCodePoints(blocks, into = new Set()) {
    for (const ch of RENDERER_LITERALS) into.add(ch.codePointAt(0));
    for (const block of blocks) {
      if (block.runs) collectRuns(block.runs, into);
      if (block.items) {
        for (const item of block.items) {
          if (item.number) for (const ch of String(item.number)) into.add(ch.codePointAt(0));
          collectRuns(item.runs, into);
        }
      }
      if (block.blocks) collectCodePoints(block.blocks, into);
      if (block.text) for (const ch of block.text) into.add(ch.codePointAt(0));
      // An image block draws its caption in the header row.
      if (block.image) for (const ch of block.image.alt || "") into.add(ch.codePointAt(0));
    }
    return into;
  }

  function collectRuns(runs, into) {
    for (const run of runs) {
      if (run.text !== undefined) for (const ch of run.text) into.add(ch.codePointAt(0));
      if (run.code !== undefined) for (const ch of run.code) into.add(ch.codePointAt(0));
      if (run.bold !== undefined) collectRuns(run.bold, into);
      if (run.italic !== undefined) collectRuns(run.italic, into);
      if (run.link !== undefined) collectRuns(run.link, into);
      if (run.img !== undefined) for (const ch of run.img.alt) into.add(ch.codePointAt(0));
      if (run.chip !== undefined) {
        for (const ch of `${run.chip.label}${run.chip.small}`) into.add(ch.codePointAt(0));
      }
    }
  }

  /* ── Image loading ────────────────────────────────────────────────────
   * JPEG: embedded directly with DCTDecode (dimensions read from SOF).
   * PNG (8-bit RGB/RGBA, non-interlaced): inflated and unfiltered here, then
   * embedded as Flate-compressed RGB (alpha composited onto white).
   * Anything else falls back to canvas decoding; failures become a small
   * placeholder box so the surrounding text still exports.
   */
  let imageCache = null; // path → decoded image info, kept across exports

  async function loadImages(paths) {
    if (!imageCache) imageCache = new Map();
    const info = new Map();
    await Promise.all([...paths].map(async (path) => {
      if (imageCache.has(path)) {
        info.set(path, imageCache.get(path));
        return;
      }
      try {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
          const size = jpegSize(bytes);
          info.set(path, size ? { ...size, data: bytes, kind: "jpeg" } : { error: true });
        } else if (bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
          info.set(path, await decodePng(bytes));
        } else {
          info.set(path, await decodeViaCanvas(bytes));
        }
      } catch {
        info.set(path, { error: true });
      }
      imageCache.set(path, info.get(path));
    }));
    return info;
  }

  function jpegSize(bytes) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      while (bytes[i] === 0xff) i += 1;
      const marker = bytes[i];
      i += 1;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
      if (marker === 0xd9) return null;
      const length = (bytes[i] << 8) | bytes[i + 1];
      if (length < 2) return null;
      const isSof = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
      if (isSof) {
        const height = (bytes[i + 3] << 8) | bytes[i + 4];
        const width = (bytes[i + 5] << 8) | bytes[i + 6];
        const components = bytes[i + 7]; // grayscale, RGB/YCC or CMYK/YCCK
        return width > 0 && height > 0 ? { w: width, h: height, components } : null;
      }
      i += length;
    }
    return null;
  }

  async function decodePng(bytes) {
    const width = readU32(bytes, 16);
    const height = readU32(bytes, 20);
    const bitDepth = bytes[24];
    const colorType = bytes[25];
    const interlace = bytes[28];
    if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0 || !width || !height) {
      return decodeViaCanvas(bytes); // palette/gray/16-bit/interlaced → canvas
    }
    const bpp = colorType === 6 ? 4 : 3;
    let i = 8;
    const idat = [];
    while (i + 8 <= bytes.length) {
      const length = readU32(bytes, i);
      const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
      if (type === "IDAT") idat.push(bytes.subarray(i + 8, i + 8 + length));
      i += 12 + length;
    }
    const inflated = await inflate(concatBytes(idat));
    if (!inflated) return decodeViaCanvas(bytes);
    const stride = width * bpp;
    const rgb = new Uint8Array(width * height * 3);
    let offset = 0;
    for (let row = 0; row < height; row++) {
      const filter = inflated[offset];
      const scanline = inflated.subarray(offset + 1, offset + 1 + stride);
      const previous = row > 0 ? inflated.subarray(offset - stride, offset) : null;
      offset += 1 + stride;
      for (let col = 0; col < stride; col++) {
        const left = col >= bpp ? scanline[col - bpp] : 0;
        const up = previous ? previous[col] : 0;
        const upLeft = previous && col >= bpp ? previous[col - bpp] : 0;
        let value;
        if (filter === 1) value = scanline[col] + left; // Sub
        else if (filter === 2) value = scanline[col] + up; // Up
        else if (filter === 3) value = scanline[col] + ((left + up) >> 1); // Average
        else if (filter === 4) value = scanline[col] + paeth(left, up, upLeft); // Paeth
        else value = scanline[col]; // None
        scanline[col] = value & 0xff;
      }
    }
    // Copy row by row: every scanline is preceded by its filter byte, so the
    // pixel data is not contiguous in the inflated buffer.
    for (let row = 0; row < height; row++) {
      let source = row * (stride + 1) + 1;
      let target = row * width * 3;
      for (let col = 0; col < width; col++) {
        if (bpp === 4) {
          const alpha = inflated[source + 3];
          rgb[target] = (inflated[source] * alpha + 255 * (255 - alpha) + 127) / 255;
          rgb[target + 1] = (inflated[source + 1] * alpha + 255 * (255 - alpha) + 127) / 255;
          rgb[target + 2] = (inflated[source + 2] * alpha + 255 * (255 - alpha) + 127) / 255;
        } else {
          rgb[target] = inflated[source];
          rgb[target + 1] = inflated[source + 1];
          rgb[target + 2] = inflated[source + 2];
        }
        source += bpp;
        target += 3;
      }
    }
    return { w: width, h: height, data: rgb, kind: "rgb" };
  }

  function paeth(left, up, upLeft) {
    const estimate = left + up - upLeft;
    const dLeft = Math.abs(estimate - left);
    const dUp = Math.abs(estimate - up);
    const dUpLeft = Math.abs(estimate - upLeft);
    if (dLeft <= dUp && dLeft <= dUpLeft) return left;
    if (dUp <= dUpLeft) return up;
    return upLeft;
  }

  function readU32(bytes, offset) {
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  }

  async function decodeViaCanvas(bytes) {
    if (typeof document === "undefined" || !document.createElement) return { error: true };
    try {
      const blob = new Blob([bytes]);
      const bitmap = typeof createImageBitmap === "function"
        ? await createImageBitmap(blob)
        : await new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const image = new Image();
            image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
            image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Decode failed")); };
            image.src = url;
          });
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const rgb = new Uint8Array(bitmap.width * bitmap.height * 3);
      for (let i = 0; i < bitmap.width * bitmap.height; i++) {
        rgb[i * 3] = pixels[i * 4];
        rgb[i * 3 + 1] = pixels[i * 4 + 1];
        rgb[i * 3 + 2] = pixels[i * 4 + 2];
      }
      return { w: bitmap.width, h: bitmap.height, data: rgb, kind: "rgb" };
    } catch {
      return { error: true };
    }
  }

  /* ── Layout ───────────────────────────────────────────────────────────
   * The renderer works top-down (y grows downward) and converts to PDF
   * coordinates when emitting. Each page holds two op lists: `bg` (painted
   * first, used for code-block backgrounds that close after the page flips)
   * and `ops` (everything else). Draw ops: text, rect, line, circle, chip,
   * image and imgfail placeholders.
   */
  class Renderer {
    constructor(options = {}) {
      this.pages = [];
      this.pageIndex = -1;
      this.y = 0;
      this.pendingGap = 0;
      this.keepTogether = false;
      this.noPageBreaks = Boolean(options.noPageBreaks); // measurement mode
      this.images = new Map(); // path → image ref index
      this.warnings = [];
    }

    newPage() {
      this.pages.push({ bg: [], ops: [] });
      this.pageIndex = this.pages.length - 1;
      this.y = MARGIN;
      this.pendingGap = 0;
    }

    push(op) {
      this.pages[this.pageIndex].ops.push(op);
    }

    /* Remembers the first content strings drawn on the current page, so the
     * editor can put its page-break marker on the same text. Chrome labels
     * ("PROBLEM", page numbers) are never passed here. */
    noteAnchor(text) {
      const page = this.pages[this.pageIndex];
      const anchor = String(text || "").replace(/\s+/g, " ").trim();
      if (!page || anchor.length < 4) return;
      if (!page.anchors) page.anchors = [];
      if (page.anchors.length >= 4 || page.anchors.includes(anchor)) return;
      page.anchors.push(anchor.slice(0, 48));
    }

    /* A page that opens with an image has no text to anchor to, so the image
     * itself is recorded instead. */
    noteImage(src) {
      const page = this.pages[this.pageIndex];
      if (page && !page.image && !(page.anchors || []).length) page.image = src;
    }

    /* Marks that the page starts with a whole boxed element (an issue card or
     * a line carrying an image or a reference chip). The editor then places its
     * marker above that element instead of inside it, so the line never cuts
     * through something the exporter keeps together. */
    markBoxStart() {
      const page = this.pages[this.pageIndex];
      if (page) page.boxStart = true;
    }

    ensure(height) {
      if (!this.noPageBreaks && !this.keepTogether && this.y + height > CONTENT_BOTTOM) this.newPage();
    }
  }

  function applyGap(r, top, bottom) {
    const atPageTop = !r.noPageBreaks && r.y === MARGIN;
    const gap = atPageTop ? 0 : Math.max(r.pendingGap, top);
    if (gap > 0) {
      if (!r.noPageBreaks && r.y + gap > CONTENT_BOTTOM) r.newPage();
      else r.y += gap;
    }
    r.pendingGap = bottom;
  }

  function layoutBlocks(r, blocks, imageInfo, x0, width, options = {}) {
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      if (block.type === "heading") {
        // The first heading inside an issue card renders at body size, as the
        // preview's .worklog-issue-title-heading does.
        const demoted = options.issueLeadHeading && index === 0;
        const size = demoted ? BODY_SIZE : HEADING_SIZE[block.level];
        const lineHeight = demoted ? BODY_LH : HEADING_LH;
        applyGap(r, demoted ? 0 : HEADING_MARGIN[0] * size, HEADING_MARGIN[1] * size);
        r.ensure(size * lineHeight * 2 + 8); // keep the heading with the first line below
        layoutParagraph(r, atomsFromRuns(block.runs, { size, color: C.text, bold: true }, imageInfo, width), { x0, width, lineHeight });
      } else if (block.type === "paragraph") {
        applyGap(r, 0, BODY_SIZE);
        layoutParagraph(r, atomsFromRuns(block.runs, { size: BODY_SIZE, color: C.text }, imageInfo, width), { x0, width });
      } else if (block.type === "quote") {
        applyGap(r, 0, BODY_SIZE);
        layoutParagraph(r, atomsFromRuns(block.runs, { size: BODY_SIZE, color: C.quote }, imageInfo, width - QUOTE_INDENT), {
          x0: x0 + QUOTE_INDENT,
          width: width - QUOTE_INDENT,
          quoteBorder: x0,
        });
      } else if (block.type === "list") {
        applyGap(r, 0, BODY_SIZE);
        for (const item of block.items) {
          layoutParagraph(r, atomsFromRuns(item.runs, { size: BODY_SIZE, color: C.text }, imageInfo, width - LIST_INDENT), {
            x0: x0 + LIST_INDENT,
            width: width - LIST_INDENT,
            marker: { bullet: true },
          });
        }
      } else if (block.type === "image") {
        layoutImageBlock(r, block.image, imageInfo, x0, width);
      } else if (block.type === "code") {
        layoutCodeBlock(r, block.text, x0, width);
      } else if (block.type === "hr") {
        applyGap(r, BODY_SIZE * 0.5, BODY_SIZE * 0.5); // the browser default `margin: .5em auto`
        r.ensure(0.75);
        r.push({ type: "line", x1: x0, y1: r.y, x2: x0 + width, y2: r.y, color: C.hr, width: 0.75 });
        r.y += 0.75;
      } else if (block.type === "issue") {
        layoutIssueBlock(r, block, imageInfo, x0, width);
      }
    }
  }

  function atomsFromRuns(runs, baseStyle, imageInfo, containerWidth) {
    const atoms = [];
    const walk = (list, style) => {
      for (const run of list) {
        if (run.text !== undefined) {
          const parts = run.text.split("\n");
          parts.forEach((part, index) => {
            if (part) atoms.push({ type: "text", text: part, style });
            if (index < parts.length - 1) atoms.push({ type: "break" });
          });
        } else if (run.code !== undefined) {
          if (run.code) atoms.push({ type: "text", text: run.code, style: { ...style, font: MONO, codeBg: true } });
        } else if (run.bold !== undefined) {
          walk(run.bold, { ...style, bold: true });
        } else if (run.italic !== undefined) {
          walk(run.italic, { ...style, italic: true });
        } else if (run.link !== undefined) {
          walk(run.link, { ...style, color: C.link, underline: true });
        } else if (run.img !== undefined) {
          const w = Math.min(containerWidth, (containerWidth * run.img.width) / 100);
          const info = imageInfo.get(run.img.path);
          if (info && info.w && info.h && !info.error) {
            atoms.push({ type: "img", w, h: (w * info.h) / info.w, key: run.img.path });
          } else {
            atoms.push({ type: "imgfail", w: Math.min(200, containerWidth), alt: run.img.alt });
          }
        } else if (run.chip !== undefined) {
          // max-width: min(100%, 440px); the label is single-line and ellipsised.
          // Both lines are measured with the face and weight they are drawn in,
          // otherwise a bold label overflows its border.
          const chipMax = Math.min(containerWidth, CHIP_MAX);
          const innerMax = Math.max(0, chipMax - CHIP_PAD_X * 2 - 0.75);
          const labelStyle = { font: SONG, size: CHIP_LABEL_SIZE, weight: 600 };
          const smallStyle = { font: SONG, size: CHIP_SMALL_SIZE };
          const label = truncateText(run.chip.label, labelStyle, innerMax);
          const small = truncateText(run.chip.small, smallStyle, innerMax);
          const width = Math.min(chipMax, Math.max(textW(label, labelStyle), textW(small, smallStyle)) + CHIP_PAD_X * 2 + 0.75);
          atoms.push({ type: "chip", w: width, h: CHIP_H, label, small, task: run.chip.task });
        }
      }
    };
    walk(runs, baseStyle);
    return atoms;
  }

  /* Punctuation that may not start or end a line (the line-breaking rules
   * every browser applies to CJK text). */
  const NO_LINE_START = "，。、；：！？）〕】》」』〉·—…％℃°”’.,;:!?)]}%";
  const NO_LINE_END = "（〔【《「『〈“‘([{";

  /* Wraps one text piece at the available width, preferring a break at a
   * space. Returns the part that fits and the remainder. */
  function splitFit(text, available, style) {
    let width = 0;
    let index = 0;
    let lastSpace = -1;
    while (index < text.length) {
      const advance = charW(text[index], style);
      if (width + advance > available + 0.001) break;
      width += advance;
      if (text[index] === " ") lastSpace = index;
      index += 1;
    }
    if (index === text.length) return [text, ""];
    if (lastSpace >= 1) return [text.slice(0, lastSpace), text.slice(lastSpace + 1)];
    if (index > 0) {
      // Keep closing punctuation with the text before it and opening
      // punctuation with the text after it.
      let cut = index;
      while (cut > 1 && NO_LINE_START.indexOf(text[cut]) !== -1) cut -= 1;
      if (cut > 0 && NO_LINE_END.indexOf(text[cut - 1]) !== -1) cut -= 1;
      return [text.slice(0, cut), text.slice(cut)];
    }
    return ["", text];
  }

  function layoutParagraph(r, atoms, opts) {
    const lead = opts.lineHeight || BODY_LH;
    let line = { items: [], x: 0, maxText: 0, chipH: 0, imgH: 0 };
    const commit = () => {
      if (!line.items.length) return;
      const lineHeight = Math.max(line.maxText * lead, line.chipH + 4, line.imgH + 4);
      r.ensure(lineHeight);
      const top = r.y;
      const baseline = top + ASCENT * line.maxText + (lineHeight - lead * line.maxText) / 2;
      if (opts.marker && !opts.marker.used) {
        r.push({ type: "circle", cx: opts.x0 - LIST_MARKER, cy: baseline - 3.5, r: 1.4, fill: C.text });
        opts.marker.used = true;
      }
      if (opts.quoteBorder !== undefined) {
        r.push({ type: "line", x1: opts.quoteBorder + QUOTE_BORDER / 2, y1: top, x2: opts.quoteBorder + QUOTE_BORDER / 2, y2: top + lineHeight, color: C.quoteBorder, width: QUOTE_BORDER });
      }
      // A line that lands on a fresh page: remember what it opens with, so the
      // editor can put its marker on the element boundary rather than inside it.
      const firstItem = line.items[0];
      if (firstItem && top === MARGIN) {
        if (firstItem.type === "img") r.noteImage(firstItem.key);
        if (firstItem.type === "img" || firstItem.type === "chip") r.markBoxStart();
      }
      if (firstItem && firstItem.type === "text") r.noteAnchor(firstItem.text);
      for (const item of line.items) {
        if (item.type === "text") {
          const x = opts.x0 + item.x;
          r.push({ type: "text", x, baseline, size: item.style.size, font: item.style.font || SONG, color: item.style.color, bold: item.style.bold, italic: item.style.italic, text: item.text });
          if (item.style.codeBg) {
            // `code` padding: 1px 4px, border-radius: 3px
            r.push({ type: "rect", x: x - 3, y: baseline - ASCENT * item.style.size - 0.75, w: textW(item.text, item.style) + 6, h: item.style.size * (ASCENT + DESCENT) + 1.5, fill: C.codeBg, radius: 2.25 });
          }
          if (item.style.underline) r.push({ type: "line", x1: x, y1: baseline + 1.2, x2: x + textW(item.text, item.style), y2: baseline + 1.2, color: item.style.color, width: 0.5 });
        } else if (item.type === "chip") {
          r.push({ type: "chip", x: opts.x0 + item.x, y: top + (lineHeight - item.h) / 2, w: item.w, h: item.h, label: item.label, small: item.small, task: item.task });
        } else if (item.type === "img") {
          r.images.set(item.key, r.images.size);
          r.push({ type: "image", x: opts.x0 + item.x, y: top + (lineHeight - item.h) / 2, w: item.w, h: item.h, key: item.key });
        } else if (item.type === "imgfail") {
          r.push({ type: "imgfail", x: opts.x0 + item.x, y: top + (lineHeight - 22) / 2, w: item.w, h: 22, alt: item.alt });
        }
      }
      r.y += lineHeight;
      line = { items: [], x: 0, maxText: 0, chipH: 0, imgH: 0 };
    };

    for (const atom of atoms) {
      if (atom.type === "break") { commit(); continue; }
      if (atom.type === "text") {
        let remaining = atom.text;
        while (remaining) {
          const available = opts.width - line.x;
          if (available <= 0.001) { commit(); continue; }
          const [fits, rest] = splitFit(remaining, available, atom.style);
          if (!fits && line.x > 0) { commit(); continue; }
          if (!fits) { // a single oversized glyph on an empty line
            const ch = remaining[0];
            line.items.push({ type: "text", text: ch, style: atom.style, x: line.x });
            line.x += charW(ch, atom.style);
            line.maxText = Math.max(line.maxText, atom.style.size);
            remaining = remaining.slice(1);
            continue;
          }
          line.items.push({ type: "text", text: fits, style: atom.style, x: line.x });
          line.x += textW(fits, atom.style);
          line.maxText = Math.max(line.maxText, atom.style.size);
          remaining = rest;
          if (remaining) commit();
        }
      } else if (atom.type === "chip" || atom.type === "img" || atom.type === "imgfail") {
        if (line.x + atom.w > opts.width + 0.001 && line.x > 0) commit();
        const w = Math.min(atom.w, opts.width);
        line.items.push({ ...atom, w, x: line.x });
        line.x += w;
        if (atom.type === "chip") line.chipH = Math.max(line.chipH, atom.h);
        if (atom.type === "img") line.imgH = Math.max(line.imgH, atom.h);
        if (atom.type === "imgfail") line.chipH = Math.max(line.chipH, 22);
      }
    }
    commit();
  }

  /* Splits a caption into the lines it will occupy in the box's header row. */
  function captionLines(text, style, maxWidth, maxLines) {
    const lines = [];
    let remaining = sanitizeText(String(text || "")).replace(/\s+/g, " ").trim() || "Image";
    while (remaining && lines.length < maxLines) {
      const [fits, rest] = splitFit(remaining, maxWidth, style);
      if (!fits) break;
      lines.push(fits);
      remaining = rest;
    }
    if (remaining && lines.length) {
      lines[lines.length - 1] = truncateText(`${lines[lines.length - 1]} ${remaining}`, style, maxWidth);
    }
    return lines.length ? lines : ["Image"];
  }

  /* The preview renders every image as a titled box (.worklog-image): a
   * summary row followed by the picture at its chosen width. An inserted
   * picture therefore keeps its caption in the export, and the box is kept on
   * one page. */
  function layoutImageBlock(r, image, imageInfo, x0, width) {
    applyGap(r, 0, BODY_SIZE); // margin: 0 0 1em
    const border = IMAGE_BORDER;
    const innerWidth = width - border * 2;
    const captionStyle = { font: SONG, size: BODY_SIZE, weight: 600 };
    const lines = captionLines(image.alt, captionStyle, innerWidth - IMAGE_CAPTION_PAD_X * 2, IMAGE_CAPTION_MAX_LINES);
    const captionHeight = IMAGE_CAPTION_PAD_Y * 2 + lines.length * BODY_SIZE * BODY_LH;
    const info = imageInfo.get(image.path);
    const imageWidth = Math.max(10, Math.min(innerWidth, (innerWidth * image.width) / 100));
    const naturalHeight = info && info.w && info.h && !info.error ? (imageWidth * info.h) / info.w : IMAGE_FAIL_HEIGHT;
    // A picture taller than the paper is scaled down so its box still fits.
    const overhead = border * 2 + captionHeight + border;
    const imageHeight = Math.min(naturalHeight, CONTENT_H - overhead);
    const boxHeight = overhead + imageHeight;
    r.ensure(boxHeight);
    const top = r.y;
    // A box that opens a page anchors the editor's page marker to its top.
    if (top === MARGIN) {
      r.noteImage(image.path);
      r.markBoxStart();
    }
    r.push({ type: "rect", x: x0, y: top, w: width, h: boxHeight, stroke: C.border, sw: border, radius: IMAGE_RADIUS });
    r.push({ type: "rect", x: x0 + border, y: top + border, w: innerWidth, h: captionHeight, fill: C.imageCaptionBg });
    lines.forEach((line, index) => {
      const lineTop = top + border + IMAGE_CAPTION_PAD_Y + index * BODY_SIZE * BODY_LH;
      r.push({
        type: "text",
        x: x0 + border + IMAGE_CAPTION_PAD_X,
        baseline: lineTop + (BODY_SIZE * BODY_LH - BODY_SIZE) / 2 + ASCENT * BODY_SIZE,
        size: BODY_SIZE,
        font: SONG,
        color: C.accent,
        weight: 600,
        text: line,
      });
    });
    // The rule between the caption and the picture (img border-top).
    const pictureTop = top + border + captionHeight;
    r.push({ type: "line", x1: x0 + border, y1: pictureTop, x2: x0 + width - border, y2: pictureTop, color: C.border, width: border });
    if (info && info.w && info.h && !info.error) {
      r.images.set(image.path, r.images.size);
      r.push({ type: "image", x: x0 + border, y: pictureTop + border, w: imageWidth, h: imageHeight, key: image.path });
    } else {
      r.push({ type: "imgfail", x: x0 + border, y: pictureTop + border, w: innerWidth, h: imageHeight, alt: image.alt });
    }
    r.y = top + boxHeight;
  }

  function layoutCodeBlock(r, source, x0, width) {
    applyGap(r, 0, BODY_SIZE);
    const style = { font: MONO, size: BODY_SIZE, color: C.text };
    const lineHeight = BODY_SIZE * BODY_LH;
    const innerWidth = width - CODE_PAD * 2;
    const visual = [];
    for (const raw of source.split("\n")) {
      let remaining = raw.replace(/\t/g, "    ").replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "?");
      if (!remaining) { visual.push(""); continue; }
      while (remaining) {
        const [fits, rest] = splitFit(remaining, innerWidth, style);
        if (!fits) { visual.push(""); break; }
        visual.push(fits);
        remaining = rest;
      }
    }
    if (!visual.length) visual.push("");
    const blockHeight = CODE_PAD * 2 + visual.length * lineHeight;
    if (blockHeight <= CONTENT_H) {
      r.ensure(blockHeight); // may flip the page, so read the page afterwards
      const page = r.pages[r.pageIndex];
      const top = r.y;
      page.bg.push({ type: "rect", x: x0, y: top, w: width, h: blockHeight, fill: C.codeBg, radius: CODE_BORDER });
      for (const line of visual) {
        // `r.y` is the top of the shaded box, so the first line starts one
        // padding below it; the glyphs are centred in their line box.
        const baseline = r.y + CODE_PAD + (lineHeight - BODY_SIZE) / 2 + ASCENT * BODY_SIZE;
        r.noteAnchor(line);
        r.push({ type: "text", x: x0 + CODE_PAD, baseline, size: BODY_SIZE, font: MONO, color: C.text, text: line });
        r.y += lineHeight;
      }
      // Advance past the whole box (both paddings), so the next block starts
      // below the shaded area instead of inside it.
      r.y = top + blockHeight;
      return;
    }
    // Taller than one page: flow with page breaks, shading each page segment.
    r.y += CODE_PAD; // top padding
    let segmentTop = r.y;
    let segmentPage = r.pageIndex;
    for (const line of visual) {
      const beforePage = r.pageIndex;
      const beforeY = r.y;
      r.ensure(lineHeight);
      if (r.pageIndex !== beforePage) {
        r.pages[beforePage].bg.push({ type: "rect", x: x0, y: segmentTop, w: width, h: Math.max(lineHeight, beforeY - segmentTop + CODE_PAD), fill: C.codeBg, radius: CODE_BORDER });
        segmentTop = r.y;
        segmentPage = r.pageIndex;
      }
      r.noteAnchor(line);
      r.push({ type: "text", x: x0 + CODE_PAD, baseline: r.y + (lineHeight - BODY_SIZE) / 2 + ASCENT * BODY_SIZE, size: BODY_SIZE, font: MONO, color: C.text, text: line });
      r.y += lineHeight;
    }
    r.y += CODE_PAD; // bottom padding
    r.pages[segmentPage].bg.push({ type: "rect", x: x0, y: segmentTop, w: width, h: Math.max(lineHeight, r.y - segmentTop), fill: C.codeBg, radius: CODE_BORDER });
  }

  function layoutIssueBlock(r, block, imageInfo, x0, width) {
    applyGap(r, BODY_SIZE, BODY_SIZE); // margin: 1em 0
    const empty = !block.blocks.length;
    const innerX = x0 + ISSUE_BODY_PAD_X;
    const innerW = width - ISSUE_BODY_PAD_X * 2;
    let innerHeight = 0;
    if (!empty) {
      // Measure the content on a scratch renderer. It must not start at the
      // page top, or the first block's margin would be dropped and the card
      // would come out shorter than the content it holds.
      const scratch = new Renderer({ noPageBreaks: true });
      scratch.newPage();
      const origin = MARGIN + 1000;
      scratch.y = origin;
      scratch.pendingGap = BODY_SIZE;
      layoutBlocks(scratch, block.blocks, imageInfo, innerX, innerW, { issueLeadHeading: true });
      innerHeight = scratch.y - origin;
    }
    // The border box wraps the header and the content, plus its own borders.
    const chromeHeight = ISSUE_BORDER * 2 + ISSUE_HEADER_H + ISSUE_BODY_PAD;
    const totalHeight = chromeHeight + (empty ? EMPTY_SIZE * BODY_LH : innerHeight) + ISSUE_BODY_PAD;
    const fitsPage = totalHeight <= CONTENT_H;
    if (fitsPage) {
      r.ensure(totalHeight);
      drawIssueChrome(r, block, x0, width, r.y, totalHeight);
      const keep = r.keepTogether;
      r.keepTogether = true;
      r.y += chromeHeight;
      if (empty) {
        r.push({ type: "text", x: innerX, baseline: r.y + ASCENT * EMPTY_SIZE, size: EMPTY_SIZE, font: SONG, color: C.faint, text: "No details yet." });
        r.y += EMPTY_SIZE * BODY_LH;
      } else {
        layoutBlocks(r, block.blocks, imageInfo, innerX, innerW, { issueLeadHeading: true });
      }
      r.y += ISSUE_BODY_PAD;
      r.keepTogether = keep;
    } else {
      // Taller than one page: keep the header on the first segment and let
      // the content flow across pages (side borders are dropped).
      const headerHeight = ISSUE_BORDER * 2 + ISSUE_HEADER_H;
      drawIssueChrome(r, block, x0, width, r.y, headerHeight);
      r.y += headerHeight + ISSUE_BODY_PAD;
      if (empty) {
        r.push({ type: "text", x: innerX, baseline: r.y + ASCENT * EMPTY_SIZE, size: EMPTY_SIZE, font: SONG, color: C.faint, text: "No details yet." });
        r.y += EMPTY_SIZE * BODY_LH;
      } else {
        layoutBlocks(r, block.blocks, imageInfo, innerX, innerW, { issueLeadHeading: true });
      }
      r.y += ISSUE_BODY_PAD;
      r.push({ type: "line", x1: x0, y1: r.y, x2: x0 + width, y2: r.y, color: C.border, width: 0.75 });
    }
  }

  function drawIssueChrome(r, block, x0, width, top, totalHeight) {
    // border: 1px solid border; border-left: 3px solid #d97706; radius 4px.
    // The accent bar is the card's left border, so the header background sits
    // to its right and never covers it.
    const border = ISSUE_BORDER;
    const headerLeft = x0 + ISSUE_ACCENT_W;
    // A card drawn at the top of a page opens that page, so the marker goes
    // above the card instead of through its title.
    if (top <= MARGIN + 0.01) r.markBoxStart();
    r.push({ type: "rect", x: x0, y: top, w: width, h: totalHeight, stroke: C.border, sw: border, radius: 3 });
    r.push({ type: "rect", x: x0, y: top, w: ISSUE_ACCENT_W, h: totalHeight, fill: C.issueAccent });
    r.push({ type: "rect", x: headerLeft, y: top + border, w: width - ISSUE_ACCENT_W - border, h: ISSUE_HEADER_H, fill: C.issueHeaderBg });
    r.push({ type: "line", x1: headerLeft, y1: top + border + ISSUE_HEADER_H, x2: x0 + width - border, y2: top + border + ISSUE_HEADER_H, color: C.border, width: border });
    // Label and badge are centred in the header row, like `align-items: center`.
    const labelTop = top + (ISSUE_HEADER_H - ISSUE_LABEL_BOX) / 2;
    const labelBaseline = labelTop + (ISSUE_LABEL_BOX - ISSUE_LABEL_SIZE) / 2 + ASCENT * ISSUE_LABEL_SIZE;
    r.push({ type: "text", x: x0 + ISSUE_PAD_X, baseline: labelBaseline, size: ISSUE_LABEL_SIZE, font: SONG, color: C.faint, bold: true, text: "PROBLEM" });
    // State badge: padding 3px 8px, border 1px, radius 3px, font 600 .7rem
    const palette = block.state === "Open" ? C.issueOpen : C.issueDone;
    const badgeHeight = ISSUE_STATE_H;
    const badgeWidth = textW(block.state, { font: SONG, size: ISSUE_STATE_SIZE, weight: 600 }) + (ISSUE_STATE_PAD_X + ISSUE_STATE_BORDER) * 2;
    const badgeX = x0 + width - ISSUE_PAD_X - badgeWidth;
    const badgeY = top + (ISSUE_HEADER_H - badgeHeight) / 2;
    r.push({ type: "rect", x: badgeX, y: badgeY, w: badgeWidth, h: badgeHeight, fill: palette.bg, stroke: palette.border, sw: ISSUE_STATE_BORDER, radius: 2.25 });
    r.push({
      type: "text",
      x: badgeX + ISSUE_STATE_PAD_X + ISSUE_STATE_BORDER,
      baseline: badgeY + ISSUE_STATE_PAD_Y + ISSUE_STATE_BORDER + (ISSUE_STATE_SIZE * ISSUE_STATE_LINE - ISSUE_STATE_SIZE) / 2 + ASCENT * ISSUE_STATE_SIZE,
      size: ISSUE_STATE_SIZE,
      font: SONG,
      color: palette.text,
      weight: 600,
      text: block.state,
    });
  }

  /* ── Emission ───────────────────────────────────────────────────────── */
  function utf16Hex(text) {
    let out = "";
    for (const ch of text) out += ch.charCodeAt(0).toString(16).padStart(4, "0");
    return out;
  }

  function asciiHex(text) {
    let out = "";
    for (let i = 0; i < text.length; i++) out += text.charCodeAt(i).toString(16).padStart(2, "0");
    return out;
  }

  /* Fallback song font: one hex string plus a TJ offset after every Latin
   * glyph so the effective advance is 0.5em instead of the 1em default. */
  function songTextPayload(text) {
    const offsets = [];
    for (let i = 0; i < text.length - 1; i++) {
      if (!isWide(text[i])) offsets.push(-500);
    }
    return offsets.length ? `[<${utf16Hex(text)}> ${offsets.join(" ")}] TJ` : `<${utf16Hex(text)}> Tj`;
  }

  /* Splits a text op into runs that share one face, exactly as the browser
   * resolves its font stack character by character. */
  function segmentsFor(text, style) {
    const segments = [];
    for (const ch of text) {
      const face = chooseFace(ch, style);
      const last = segments.length ? segments[segments.length - 1] : null;
      if (last && last.subset === face.subset && last.font === face.font && last.shear === face.shear && last.pseudoBold === face.pseudoBold) {
        last.text += ch;
      } else {
        segments.push({ text: ch, subset: face.subset, font: face.font, shear: face.shear, pseudoBold: face.pseudoBold });
      }
    }
    return segments;
  }

  /* Emits one font-homogeneous run. Text operators are only valid inside
   * BT/ET, which strict viewers enforce. */
  function emitSegment(op, segment, out, x) {
    const y = PAGE_H - op.baseline;
    const [r, g, b] = op.color;
    const resource = segment.subset ? segment.subset.name : segment.font === MONO ? "F1" : "F0";
    out.push("BT", `/${resource} ${fmt(op.size)} Tf`);
    out.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg`);
    out.push(`${segment.shear ? "1 0 0.26 1" : "1 0 0 1"} ${fmt(x)} ${fmt(y)} Tm`);
    if (segment.pseudoBold) out.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} RG ${fmt(Math.max(0.6, op.size * 0.035))} w 2 Tr`);
    if (segment.subset) out.push(`<${cidHex(segment.text, segment.subset)}> Tj`);
    else if (segment.font === MONO) out.push(`<${asciiHex(segment.text)}> Tj`);
    else out.push(songTextPayload(segment.text));
    if (segment.pseudoBold) out.push("0 Tr");
    out.push("ET");
  }

  /* Draws a text op, advancing by each run's measured width. */
  function emitText(op, out, xOffset = 0) {
    if (!op.text) return;
    let offset = 0;
    for (const segment of segmentsFor(op.text, op)) {
      emitSegment(op, segment, out, op.x + xOffset + offset);
      offset += textW(segment.text, op);
    }
  }

  function emitRect(op, out) {
    const x = fmt(op.x);
    const y = fmt(PAGE_H - op.y - op.h);
    const w = fmt(op.w);
    const h = fmt(op.h);
    if (op.radius) {
      // Rounded rectangle: walk the outline once (bottom edge, right edge, top
      // edge, left edge) with a quarter-circle at each corner. `v` uses the
      // current point as the first control point, so each corner is one op.
      const radius = Math.min(op.radius, op.w / 2, op.h / 2);
      const bottom = PAGE_H - op.y - op.h;
      const top = PAGE_H - op.y;
      out.push(
        `${fmt(op.x + radius)} ${fmt(bottom)} m`,
        `${fmt(op.x + op.w - radius)} ${fmt(bottom)} l`,
        `${fmt(op.x + op.w)} ${fmt(bottom)} ${fmt(op.x + op.w)} ${fmt(bottom + radius)} v`,
        `${fmt(op.x + op.w)} ${fmt(top - radius)} l`,
        `${fmt(op.x + op.w)} ${fmt(top - radius)} ${fmt(op.x + op.w - radius)} ${fmt(top)} v`,
        `${fmt(op.x + radius)} ${fmt(top)} l`,
        `${fmt(op.x)} ${fmt(top)} ${fmt(op.x)} ${fmt(top - radius)} v`,
        `${fmt(op.x)} ${fmt(bottom + radius)} l`,
        `${fmt(op.x)} ${fmt(bottom + radius)} ${fmt(op.x + radius)} ${fmt(bottom)} v`,
        "h"
      );
    } else {
      out.push(`${x} ${y} ${w} ${h} re`);
    }
    if (op.fill && op.stroke) {
      const [fr, fg, fb] = op.fill;
      const [sr, sg, sb] = op.stroke;
      out.push(`${fmt(fr)} ${fmt(fg)} ${fmt(fb)} rg`, `${fmt(sr)} ${fmt(sg)} ${fmt(sb)} RG ${fmt(op.sw || 0.75)} w`, "B");
    } else if (op.fill) {
      const [fr, fg, fb] = op.fill;
      out.push(`${fmt(fr)} ${fmt(fg)} ${fmt(fb)} rg`, "f");
    } else if (op.stroke) {
      const [sr, sg, sb] = op.stroke;
      out.push(`${fmt(sr)} ${fmt(sg)} ${fmt(sb)} RG ${fmt(op.sw || 0.75)} w`, "S");
    }
  }

  function emitLine(op, out) {
    const [r, g, b] = op.color;
    out.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} RG ${fmt(op.width)} w`);
    out.push(`${fmt(op.x1)} ${fmt(PAGE_H - op.y1)} m ${fmt(op.x2)} ${fmt(PAGE_H - op.y2)} l S`);
  }

  function emitCircle(op, out) {
    const cx = op.cx;
    const cy = PAGE_H - op.cy;
    const r = op.r;
    const k = r * 0.5523;
    const [cr, cg, cb] = op.fill;
    out.push(
      `${fmt(cr)} ${fmt(cg)} ${fmt(cb)} rg`,
      `${fmt(cx + r)} ${fmt(cy)} m`,
      `${fmt(cx + r)} ${fmt(cy + k)} ${fmt(cx + k)} ${fmt(cy + r)} ${fmt(cx)} ${fmt(cy + r)} c`,
      `${fmt(cx - k)} ${fmt(cy + r)} ${fmt(cx - r)} ${fmt(cy + k)} ${fmt(cx - r)} ${fmt(cy)} c`,
      `${fmt(cx - r)} ${fmt(cy - k)} ${fmt(cx - k)} ${fmt(cy - r)} ${fmt(cx)} ${fmt(cy - r)} c`,
      `${fmt(cx + k)} ${fmt(cy - r)} ${fmt(cx + r)} ${fmt(cy - k)} ${fmt(cx + r)} ${fmt(cy)} c`,
      "f"
    );
  }

  function emitChip(op, out) {
    // .worklog-task-reference / .worklog-resource-reference: padding 3px 7px,
    // radius 3px, label 600 .85em, meta .72em
    emitRect({
      x: op.x,
      y: op.y,
      w: op.w,
      h: op.h,
      fill: op.task ? C.taskChipBg : C.chipBg,
      stroke: op.task ? C.taskChipBorder : C.border,
      sw: 0.75,
      radius: 2.25,
    }, out);
    // Two stacked lines, each centred in its own line box.
    const labelTop = op.y + CHIP_PAD_Y + CHIP_LEAD;
    const labelBox = CHIP_LABEL_SIZE * CHIP_LINE;
    const smallBox = CHIP_SMALL_SIZE * CHIP_LINE;
    emitText({
      x: op.x + CHIP_PAD_X + 0.75,
      baseline: labelTop + (labelBox - CHIP_LABEL_SIZE) / 2 + ASCENT * CHIP_LABEL_SIZE,
      size: CHIP_LABEL_SIZE, font: SONG, color: op.task ? C.taskChipText : C.text, weight: 600, text: op.label,
    }, out);
    emitText({
      x: op.x + CHIP_PAD_X + 0.75,
      baseline: labelTop + labelBox + (smallBox - CHIP_SMALL_SIZE) / 2 + ASCENT * CHIP_SMALL_SIZE,
      size: CHIP_SMALL_SIZE, font: SONG, color: C.muted, text: op.small,
    }, out);
  }

  function emitImgFail(op, out) {
    emitRect({ x: op.x, y: op.y, w: op.w, h: op.h, fill: C.chipBg, stroke: C.border, sw: 0.75, radius: 2.25 }, out);
    emitText({ x: op.x + CHIP_PAD_X + 1.5, baseline: op.y + op.h / 2 + (ASCENT * 8) / 2, size: 8, font: SONG, color: C.muted, text: truncateText(`[Image] ${op.alt}`, { font: SONG, size: 8 }, op.w - 14) }, out);
  }

  function emitOps(ops, imageIds) {
    const out = [];
    for (const op of ops) {
      if (op.type === "text") {
        emitText(op, out); // picks the face per character, like the browser
      } else if (op.type === "rect") emitRect(op, out);
      else if (op.type === "line") emitLine(op, out);
      else if (op.type === "circle") emitCircle(op, out);
      else if (op.type === "chip") emitChip(op, out);
      else if (op.type === "imgfail") emitImgFail(op, out);
      else if (op.type === "image") {
        const y = PAGE_H - op.y - op.h;
        out.push("q", `${fmt(op.w)} 0 0 ${fmt(op.h)} ${fmt(op.x)} ${fmt(y)} cm`, `/Im${imageIds.get(op.key)} Do`, "Q");
      }
    }
    return out.join("\n");
  }

  /* ── Font objects ───────────────────────────────────────────────────── */
  const IDENTITY_CMAP = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n` +
    `/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n` +
    `/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n` +
    `1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n` +
    `1 beginbfrange\n<0000> <FFFF> <0000>\nendbfrange\n` +
    `endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;

  function bfcharCMap(pairs) {
    const lines = [
      "/CIDInit /ProcSet findresource begin",
      "12 dict begin",
      "begincmap",
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
      "/CMapName /Adobe-Identity-UCS def",
      "/CMapType 2 def",
      "1 begincodespacerange",
      "<0000> <FFFF>",
      "endcodespacerange",
    ];
    for (let i = 0; i < pairs.length; i += 100) {
      const chunk = pairs.slice(i, i + 100);
      lines.push(`${chunk.length} beginbfchar`);
      for (const [cid, codePoint] of chunk) {
        lines.push(`<${cid.toString(16).padStart(4, "0")}> <${codePoint.toString(16).padStart(4, "0")}>`);
      }
      lines.push("endbfchar");
    }
    lines.push("endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end");
    return lines.join("\n");
  }

  /* Groups widths into PDF `/W` runs: `0 [w0 w1 w2 …]`. */
  function widthsArray(widths) {
    const runs = [];
    let runStart = -1;
    let runValues = [];
    for (const [cid, width] of widths) {
      if (runStart === -1) { runStart = cid; runValues = [width]; continue; }
      if (cid === runStart + runValues.length) { runValues.push(width); continue; }
      runs.push(`${runStart} [${runValues.join(" ")}]`);
      runStart = cid;
      runValues = [width];
    }
    if (runStart !== -1) runs.push(`${runStart} [${runValues.join(" ")}]`);
    return `[${runs.join(" ")}]`;
  }

  /* ── Entry point ────────────────────────────────────────────────────── */

  /* Parses the document, loads the fonts and images and lays every page out.
   * Shared by the exporter and by the editor's page-break markers, so both
   * agree on where the pages actually break. */
  async function layoutDocument({ title, updatedAt, markdown, palette, metricsOnly = false }) {
    const { blocks, imagePaths } = parseDocument(markdown);
    const safeTitleText = sanitizeText(String(title || "Untitled work log"));
    const metaText = sanitizeText(String(updatedAt || ""));
    const codePoints = collectCodePoints(blocks);
    for (const ch of `${safeTitleText}${metaText}`) codePoints.add(ch.codePointAt(0));

    const needsCjk = [...codePoints].some((codePoint) => codePoint > 0xff);
    const [imageInfo, faces] = await Promise.all([loadImages(imagePaths), loadExportFonts(needsCjk)]);
    C = buildColors(palette);
    SUBSETS = buildSubsets(faces, codePoints, metricsOnly);

    const renderer = new Renderer();
    renderer.newPage();

    // Document header (first page only), echoing the title shown above the editor.
    const safeTitle = truncateText(safeTitleText, { size: HEADING_SIZE[1], bold: true }, CONTENT_W);
    renderer.push({ type: "text", x: MARGIN, baseline: MARGIN + ASCENT * HEADING_SIZE[1], size: HEADING_SIZE[1], font: SONG, color: C.text, bold: true, text: safeTitle });
    renderer.y += HEADING_SIZE[1] * HEADING_LH;
    if (metaText) {
      renderer.push({ type: "text", x: MARGIN, baseline: renderer.y + ASCENT * META_SIZE, size: META_SIZE, font: SONG, color: C.muted, text: metaText });
      renderer.y += META_SIZE * BODY_LH;
    }
    renderer.y += BODY_SIZE * 2; // gap before the document body

    if (blocks.length) {
      layoutBlocks(renderer, blocks, imageInfo, MARGIN, CONTENT_W);
    } else {
      renderer.push({ type: "text", x: MARGIN, baseline: renderer.y + ASCENT * BODY_SIZE, size: BODY_SIZE, font: SONG, color: C.text, text: "No entries yet." });
    }

    // Footer page numbers.
    renderer.pages.forEach((page, index) => {
      const label = `Page ${index + 1}`;
      page.ops.push({ type: "text", x: (PAGE_W - textW(label, { font: SONG, size: FOOTER_SIZE })) / 2, baseline: PAGE_H - 24, size: FOOTER_SIZE, font: SONG, color: C.faint, text: label });
    });

    return { renderer, imageInfo, safeTitleText };
  }

  /* Where the exported pages break: for each page after the first, the content
   * strings it opens with, the image it opens with (if any), and whether it
   * starts on a whole boxed element. The editor matches these against the
   * preview or the Markdown source to place its page markers. */
  async function pageBreaks({ title, updatedAt, markdown, palette }) {
    try {
      const { renderer } = await layoutDocument({ title, updatedAt, markdown, palette, metricsOnly: true });
      return renderer.pages
        .map((page, index) => ({
          page: index + 1,
          anchors: page.anchors || [],
          image: page.image || null,
          boxStart: Boolean(page.boxStart),
        }))
        .filter((entry) => entry.page > 1 && (entry.anchors.length || entry.image));
    } finally {
      SUBSETS = null;
      C = null;
    }
  }

  async function exportDocument({ title, updatedAt, markdown, palette }) {
    const { renderer, imageInfo, safeTitleText } = await layoutDocument({ title, updatedAt, markdown, palette });

    try {
      // Assemble the PDF.
      const writer = new PdfWriter();
      const catalogId = writer.addObject(["null"]); // filled after the pages exist
      const pagesId = writer.addObject(["null"]); // filled after the page objects exist

      // One PDF font per embedded face; Courier and the predefined song font
      // only when there is no embedded face for that role.
      const fontIds = new Map();
      if (SUBSETS) {
        for (const role of ["ui", "mono", "cjk"]) {
          for (const style of FACE_KEYS) {
            const subset = SUBSETS[role][style];
            if (subset) fontIds.set(subset.name, await writeEmbeddedFont(writer, subset));
          }
        }
      } else {
        fontIds.set("F0", await writePredefinedFont(writer));
        fontIds.set("F1", writer.addObject(["<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"]));
      }

      // Image XObjects, in renderer.images order so /ImN matches emitOps.
      const imageObjectIds = [];
      for (const [path] of renderer.images) {
        const info = imageInfo.get(path) || { w: 1, h: 1, data: new Uint8Array([255, 255, 255]), kind: "rgb" };
        const colorSpace = info.components === 1 ? "/DeviceGray" : info.components === 4 ? "/DeviceCMYK" : "/DeviceRGB";
        const decode = info.components === 4 ? " /Decode [1 0 1 0 1 0 1 0]" : ""; // Adobe CMYK JPEGs are inverted
        const dict = `/Type /XObject /Subtype /Image /Width ${info.w} /Height ${info.h} /ColorSpace ${colorSpace} /BitsPerComponent 8${decode}`;
        imageObjectIds.push(
          info.kind === "jpeg"
            ? writer.addObject([`<< ${dict} /Filter /DCTDecode /Length ${info.data.length} >>\nstream\n`, info.data, `\nendstream`])
            : await writer.addStream([dict], info.data)
        );
      }

      const fontResources = [...fontIds].map(([name, id]) => `/${name} ${id} 0 R`).join(" ");
      const imageResources = [...renderer.images.keys()]
        .map((path, index) => `/Im${index} ${imageObjectIds[index]} 0 R`)
        .join(" ");
      const pageObjectIds = [];
      for (let i = 0; i < renderer.pages.length; i++) {
        // The page is painted with the editor surface colour, so a dark theme
        // exports the same way it looks on screen.
        const [sr, sg, sb] = C.surface;
        const content = `${fmt(sr)} ${fmt(sg)} ${fmt(sb)} rg 0 0 ${PAGE_W} ${PAGE_H} re f\n` +
          emitOps(renderer.pages[i].bg.concat(renderer.pages[i].ops), renderer.images);
        const contentId = await writer.addStream([], enc(content));
        const resources = `<< /Font << ${fontResources} >> /XObject << ${imageResources} >> >>`;
        pageObjectIds.push(writer.addObject([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${resources} /Contents ${contentId} 0 R >>`]));
      }
      writer.objects[pagesId - 1] = enc(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`);
      const infoId = writer.addObject([`<< /Producer (Daily Studio Work Log PDF) /Title <FEFF${utf16Hex(safeTitleText)}> >>`]);
      writer.objects[catalogId - 1] = enc(`<< /Type /Catalog /Pages 2 0 R /Info ${infoId} 0 R >>`);

      const bytes = await writer.build();
      const filename = `${String(title || "work-log").replace(/[\\/:*?"<>|]/g, "-").trim() || "work-log"}.pdf`;
      return { blob: new Blob([bytes], { type: "application/pdf" }), filename, embeddedFont: Boolean(SUBSETS), warnings: renderer.warnings };
    } finally {
      SUBSETS = null;
      C = null;
    }
  }

  /* Embedded subset: CIDFontType2 with Identity-H, CIDs equal to the subset's
   * dense glyph indices, real widths in /W, and a ToUnicode map back to the
   * document's characters so copy/search work. */
  async function writeEmbeddedFont(writer, subset) {
    const scale = (value) => Math.round((value * 1000) / subset.unitsPerEm);
    const fontFileId = await writer.addStream([`/Length1 ${subset.file.length}`], subset.file);
    const descriptorId = writer.addObject([
      `<< /Type /FontDescriptor /FontName /${subset.name} /Flags 4 ` +
        `/FontBBox [${subset.bbox.map(scale).join(" ")}] /ItalicAngle 0 ` +
        `/Ascent ${scale(subset.ascender)} /Descent ${scale(subset.descender)} /CapHeight ${scale(subset.ascender * 0.7)} ` +
        `/StemV 80 /FontFile2 ${fontFileId} 0 R >>`,
    ]);
    const descendantId = writer.addObject([
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${subset.name} ` +
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> " +
        `/FontDescriptor ${descriptorId} 0 R /DW 1000 /W ${widthsArray(subset.widths)} /CIDToGIDMap /Identity >>`,
    ]);
    const toUnicodeId = await writer.addStream([], enc(bfcharCMap(subset.toUnicodePairs)));
    return writer.addObject([
      `<< /Type /Font /Subtype /Type0 /BaseFont /${subset.name} /Encoding /Identity-H ` +
        `/DescendantFonts [${descendantId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`,
    ]);
  }

  /* Fallback: the predefined Adobe-GB1 font, which needs no embedding but is
   * only reliably rendered by viewers that substitute their own CJK font. */
  async function writePredefinedFont(writer) {
    const toUnicodeId = await writer.addStream(["/Length1 394"], enc(IDENTITY_CMAP));
    return writer.addObject([
      "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H " +
        "/DescendantFonts [ << /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light " +
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >> ] " +
        `/ToUnicode ${toUnicodeId} 0 R >>`,
    ]);
  }

  global.WorkLogPdf = { exportDocument, pageBreaks };
})(typeof globalThis !== "undefined" ? globalThis : window);
