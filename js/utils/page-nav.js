/**
 * PageNav — the page switcher that drops out of the sidebar logo.
 * Hovering (or focusing) the logo reveals one article icon per page,
 * each tinted with that page's own accent color. Mounts itself on load,
 * so every page just needs to include this file.
 */
/**
 * A turning leaf for the docs icon. Its spine edge runs down x=13 from
 * y=3 to y=19 — exactly the book's own spine — so a leaf sits flush
 * with the binding. The outer edge is pushed out past the cover, so a
 * page sweeps beyond the book as it turns.
 */
const BOOK_LEAF = "M13 3c3.1-.7 6.3-1 8.8-.6v16.2c-2.5-.4-5.7-.2-8.8.4z";

class PageNav {

  // ── Page icons ────────────────────────────────────────────
  // Single source of truth: the same markup is used for a page's
  // sidebar logo AND its entry in the switcher, so the two can
  // never drift apart.
  static #ICON = {
    // stacked layers, listed top to bottom — highlighted in that order
    studio: `<path class="pn-layer" d="M12 2L2 7l10 5 10-5-10-5z"/>
             <path class="pn-layer pn-layer-2" d="M2 12l10 5 10-5"/>
             <path class="pn-layer pn-layer-3" d="M2 17l10 5 10-5"/>`,
    // sliders
    admin: `<line x1="4" y1="21" x2="4" y2="14"/>
            <line x1="4" y1="10" x2="4" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12" y2="3"/>
            <line x1="20" y1="21" x2="20" y2="16"/>
            <line x1="20" y1="12" x2="20" y2="3"/>
            <line class="pn-knob pn-knob-1" x1="1" y1="14" x2="7" y2="14"/>
            <line class="pn-knob pn-knob-2" x1="9" y1="8" x2="15" y2="8"/>
            <line class="pn-knob pn-knob-3" x1="17" y1="16" x2="23" y2="16"/>`,
    // open book, with three oversized leaves that riffle across the
    // spine on hover. They are deliberately larger than the book, so a
    // turning page sweeps out past its edges.
    docs: `<path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H11v16H5.5A2.5 2.5 0 0 0 3 21.5z"/>
           <path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H13v16h5.5a2.5 2.5 0 0 1 2.5 2.5z"/>
           ${[1, 2, 3, 4, 5].map((n) =>
             `<path class="pn-flip pn-flip-${n}" d="${BOOK_LEAF}"/>`).join("")}`,
  };

  /** Wrap a page icon in the shared <svg> shell (size comes from CSS). */
  static #svg(id) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${
      this.#ICON[id]
    }</svg>`;
  }

  // ── Page registry ─────────────────────────────────────────
  static get #PAGES() {
    return [
      { id: "studio", label: "Studio", file: "index.html",
        accent: CONFIG.accent,      glow: CONFIG.glow },
      { id: "admin",  label: "Admin",  file: "admin.html",
        accent: CONFIG.adminAccent, glow: CONFIG.adminGlow },
      { id: "docs",   label: "Docs",   file: "docs.html",
        accent: CONFIG.docsAccent,  glow: CONFIG.docsGlow },
    ];
  }

  /** Which registry entry the current URL points at. */
  static #currentId() {
    const file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    if (file === "admin" || file === "admin.html") return "admin";
    if (file === "docs" || file === "docs.html") return "docs";
    return "studio";
  }

  /** "#2f6fed" + .13 → "rgba(47,111,237,.13)" */
  static #tint(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  // ── Random shape morphing ─────────────────────────────────
  // A CSS keyframe animation repeats on a fixed cycle, which reads as
  // mechanical. Instead the tile's morph inputs are re-rolled to fresh
  // random values at random intervals while the item is hovered; the
  // transitions in the stylesheet turn each re-roll into a smooth move.
  static #morphTimer = null;

  static #installMorph(item) {
    item.addEventListener("pointerenter", () => this.#morphStart(item));
    item.addEventListener("pointerleave", () => this.#morphStop(item));
  }

  static #morphStart(item) {
    clearTimeout(this.#morphTimer);
    const step = () => {
      this.#rollMorph(item);
      // 560–1260ms, so the rhythm itself never settles
      this.#morphTimer = setTimeout(step, 560 + Math.random() * 700);
    };
    step();
  }

  static #morphStop(item) {
    clearTimeout(this.#morphTimer);
    this.#morphTimer = null;
    this.#writeMorph(item, {
      rot: 0, skx: 0, sky: 0, sx: 1, sy: 1,
      r: [25, 25, 25, 25], grot: 0, gskx: 0, gsky: 0,
    });
  }

  // Amplitudes are capped so the worst-case rotated/sheared box still
  // clears the panel's side inset — the tile may break the top edge,
  // never the left or right one.
  static #rollMorph(item) {
    const rnd = (a, b) => a + Math.random() * (b - a);
    this.#writeMorph(item, {
      rot: rnd(-4.5, 4.5),      // rotate
      skx: rnd(-8, 8),          // shear x
      sky: rnd(-3.5, 3.5),      // shear y
      sx: rnd(.92, 1.08),       // non-uniform squash
      sy: rnd(.92, 1.08),
      r: [rnd(25, 33), rnd(25, 33), rnd(25, 33), rnd(25, 33)],  // blob corners
      grot: rnd(-5.5, 5.5),     // the glyph drifts on its own numbers
      gskx: rnd(-8, 8),
      gsky: rnd(-3, 3),
    });
  }

  static #writeMorph(item, m) {
    const tile = item.querySelector(".page-nav-tile");
    if (!tile) return;
    const s = tile.style;
    const deg = (v) => v.toFixed(2) + "deg";
    s.setProperty("--m-rot", deg(m.rot));
    s.setProperty("--m-skx", deg(m.skx));
    s.setProperty("--m-sky", deg(m.sky));
    s.setProperty("--m-sx", m.sx.toFixed(3));
    s.setProperty("--m-sy", m.sy.toFixed(3));
    s.setProperty("--m-r1", m.r[0].toFixed(1) + "%");
    s.setProperty("--m-r2", m.r[1].toFixed(1) + "%");
    s.setProperty("--m-r3", m.r[2].toFixed(1) + "%");
    s.setProperty("--m-r4", m.r[3].toFixed(1) + "%");
    s.setProperty("--m-grot", deg(m.grot));
    s.setProperty("--m-gskx", deg(m.gskx));
    s.setProperty("--m-gsky", deg(m.gsky));
  }

  // ── Page transition: the accent floods in, then dissipates ──
  // Clicking an entry floods the viewport with that page's accent,
  // spreading out of the icon and devouring the current page; only then
  // does it navigate. The arriving page is covered before its first
  // paint, and the flood then dissipates — a soft-edged hole opens at
  // the vortex centre and widens until nothing is left. Durations are
  // kept in step with the .page-wipe-disc transitions.
  static #WIPE_MS = 310;    // flood out
  static #CLEAR_MS = 450;   // dissipation
  static #WIPE_KEY = "ds_wipe";

  static #readPending(clear) {
    try {
      const raw = sessionStorage.getItem(this.#WIPE_KEY);
      if (clear) sessionStorage.removeItem(this.#WIPE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  static #wipeEl() {
    let el = document.getElementById("page-wipe");
    if (el) return el;

    // The warp filter lives on the wrapper and the clip on a child,
    // because CSS applies clip-path *after* filter: clipping a filtered
    // element would leave a clean rim. Filtering a clipped child bends
    // the flood's rim into a ragged, wave-like boundary instead.
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "page-wipe-warp");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML =
      // flooding: solid body, sharp rim, glowing edge — no voids yet
      '<filter id="pn-wipe-warp" x="-30%" y="-30%" width="160%" height="160%">' +
        this.#warpChain(false) + this.#edgeChain("body") +
      '</filter>' +
      // burning: long branches plus voids eaten through the body
      '<filter id="pn-wipe-burn" x="-30%" y="-30%" width="160%" height="160%">' +
        this.#warpChain(true) + this.#edgeChain("body") +
      '</filter>';
    document.body.appendChild(svg);

    el = document.createElement("div");
    el.id = "page-wipe";
    el.className = "page-wipe";
    const disc = document.createElement("div");
    disc.className = "page-wipe-disc";
    el.appendChild(disc);
    document.body.appendChild(el);
    return el;
  }

  static #wipeDisc(el) {
    return el.querySelector(".page-wipe-disc");
  }

  // ── Filter chain pieces ───────────────────────────────────
  // type="turbulence" (not fractalNoise) matters throughout: it folds
  // the noise to its absolute value, leaving hard creases along every
  // zero crossing, so displaced rims come to points instead of arcs.

  /** Sharp branching displacement, ending in a result named "body". */
  static #warpChain(longBranches) {
    if (!longBranches) {
      return '<feTurbulence type="turbulence" baseFrequency="0.010 0.017" numOctaves="2" seed="9" result="n">' +
               '<animate attributeName="baseFrequency" dur="3.6s" repeatCount="indefinite" ' +
                        'values="0.010 0.018;0.019 0.011;0.013 0.023;0.010 0.018"/>' +
             '</feTurbulence>' +
             '<feDisplacementMap in="SourceGraphic" in2="n" scale="150" ' +
                                'xChannelSelector="R" yChannelSelector="G" result="body"/>';
    }
    // The noise is quantised into hard steps before it drives the
    // displacement. A smooth field gives rounded, blobby branches; a
    // stepped one makes the offset piecewise-constant, so the burn front
    // breaks along straight, hard-edged facets instead of arcs. R and G
    // are quantised differently so the two axes vary independently.
    // fractalNoise, not turbulence, for this pass: turbulence is heavily
    // skewed toward low values, so snapping it to discrete steps leaves a
    // mean far from 0.5 — and feDisplacementMap reads 0.5 as "no shift",
    // so that skew slides the whole flame bodily off the screen.
    // fractalNoise is centred on 0.5, and the hard edges come from the
    // quantisation below either way.
    return '<feTurbulence type="fractalNoise" baseFrequency="0.0028 0.0045" numOctaves="2" seed="23" result="coarse">' +
             '<animate attributeName="seed" dur="4.6s" repeatCount="indefinite" values="23;41;17;23"/>' +
           '</feTurbulence>' +
           '<feComponentTransfer in="coarse" result="stepped">' +
             '<feFuncR type="discrete" tableValues="0.12 0.28 0.44 0.60 0.76 0.92"/>' +
             '<feFuncG type="discrete" tableValues="0.92 0.44 0.76 0.20 0.60 0.28"/>' +
             '<feFuncB type="discrete" tableValues="0.5 0.5 0.5 0.5 0.5 0.5"/>' +
           '</feComponentTransfer>' +
           '<feDisplacementMap in="SourceGraphic" in2="stepped" scale="200" ' +
                              'xChannelSelector="R" yChannelSelector="G" result="branched"/>' +
           '<feTurbulence type="turbulence" baseFrequency="0.009 0.014" numOctaves="1" seed="9" result="fine">' +
             '<animate attributeName="baseFrequency" dur="3.6s" repeatCount="indefinite" ' +
                      'values="0.008 0.013;0.013 0.008;0.010 0.016;0.008 0.013"/>' +
           '</feTurbulence>' +
           '<feDisplacementMap in="branched" in2="fine" scale="45" ' +
                              'xChannelSelector="R" yChannelSelector="G" result="body"/>';
  }

  /** Bloated halo outside the rim plus a hot band just inside it. Both
   *  come from one blur — far cheaper than two feMorphology passes:
   *    out(soft, shape)  = the blurred light falling outside the shape
   *    out(shape, soft)  = the shape's own skin within a blur-width
   */
  static #edgeChain(from) {
    return '<feGaussianBlur in="' + from + '" stdDeviation="13" result="soft"/>' +
           '<feComposite in="soft" in2="' + from + '" operator="out" result="halo"/>' +
           '<feFlood class="pn-wipe-halo" result="haloColor"/>' +
           '<feComposite in="haloColor" in2="halo" operator="in" result="haloFill"/>' +
           '<feComposite in="' + from + '" in2="soft" operator="out" result="band"/>' +
           '<feFlood class="pn-wipe-hot" result="hotColor"/>' +
           '<feComposite in="hotColor" in2="band" operator="in" result="hotFill"/>' +
           '<feMerge>' +
             '<feMergeNode in="haloFill"/>' +
             '<feMergeNode in="' + from + '"/>' +
             '<feMergeNode in="hotFill"/>' +
           '</feMerge>';
  }

  /** How far the flood element extends past the viewport on each side.
   *  Must match --wipe-pad in the stylesheet. */
  static #PAD = 150;

  /** Radius reaching the furthest corner of that oversized box, so the
   *  flood covers every edge even after the warp filter displaces it. */
  static #radiusAt(x, y) {
    const p = this.#PAD;
    return Math.hypot(
      Math.max(x + p, innerWidth + p - x),
      Math.max(y + p, innerHeight + p - y)
    );
  }

  /** This page's own accent — read from the registry rather than from
   *  the CSS variable, which is not applied yet this early. */
  static #myAccent() {
    const me = this.#PAGES.find((p) => p.id === this.#currentId());
    return me ? me.accent : CONFIG.accent;
  }

  /** Aim the flood at viewport point (x, y). The element is padded, so
   *  its own coordinate space is offset by #PAD — hence the shift. */
  static #cover(disc, x, y, color, radius) {
    const px = x + this.#PAD;
    const py = y + this.#PAD;
    // The halo spilling off the burning edge is tinted with the same
    // accent as the body; the filter can't read the disc's own scope.
    const svg = document.querySelector(".page-wipe-warp");
    if (svg) svg.style.setProperty("--wipe-glow", color);
    disc.style.transition = "none";
    disc.style.setProperty("--wipe-color", color);
    disc.style.setProperty("--wipe-x", px + "px");   // vortex centre
    disc.style.setProperty("--wipe-y", py + "px");
    disc.style.setProperty("--wipe-clear", "0px");
    disc.style.clipPath = `circle(${radius}px at ${px}px ${py}px)`;
  }

  static #hideWipe() {
    const wrap = document.getElementById("page-wipe");
    if (!wrap) return;
    wrap.classList.remove("is-flooding", "is-burning");
    const disc = this.#wipeDisc(wrap);
    if (!disc) return;
    disc.style.transition = "none";
    disc.style.clipPath = "circle(0px at 50% 50%)";
    disc.style.setProperty("--wipe-clear", "0px");
  }

  /**
   * Runs at parse time: an arriving page is covered before its first
   * paint, so it can never flash into view ahead of the dissipation.
   */
  static primeWipe() {
    const p = this.#readPending(false);
    if (!p) return;
    const wrap = this.#wipeEl();
    const disc = this.#wipeDisc(wrap);
    wrap.classList.add("is-burning");
    const x = p.x * innerWidth;
    const y = p.y * innerHeight;
    this.#cover(disc, x, y, this.#myAccent(), this.#radiusAt(x, y));
    disc.dataset.primed = "1";
  }

  /** Lets the flood dissipate, opening the new page up from the centre. */
  static playWipeIn() {
    const p = this.#readPending(true);
    if (!p) return;

    const wrap = this.#wipeEl();
    const disc = this.#wipeDisc(wrap);
    const x = p.x * innerWidth;
    const y = p.y * innerHeight;

    if (disc.dataset.primed !== "1") {
      wrap.classList.add("is-burning");
      this.#cover(disc, x, y, this.#myAccent(), this.#radiusAt(x, y));
    }
    delete disc.dataset.primed;

    requestAnimationFrame(() => {
      disc.style.transition = "";
      // Clear radius runs past the furthest corner of the padded box, so
      // the flood is gone from the edges — the last place it lingers.
      disc.style.setProperty("--wipe-clear", Math.ceil(this.#radiusAt(x, y) * 1.02) + "px");
      setTimeout(() => this.#hideWipe(), this.#CLEAR_MS + 140);
    });
  }

  /** Whether the flood transition is switched on. Read per click, so
   *  the admin toggle takes effect without reloading the page. */
  static wipeEnabled() {
    try {
      const raw = localStorage.getItem(CONFIG.wipeEnabledKey);
      return raw === null ? CONFIG.wipeEnabled : raw === "1";
    } catch { return CONFIG.wipeEnabled; }
  }

  static #installWipe(link, page) {
    link.addEventListener("click", (ev) => {
      if (!this.wipeEnabled()) return;                            // plain navigation
      if (link.classList.contains("is-current")) return;          // already here
      if (ev.defaultPrevented || ev.button !== 0) return;         // middle click
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      ev.preventDefault();

      const r = (link.querySelector(".page-nav-tile") || link).getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;

      const wrap = this.#wipeEl();
      const disc = this.#wipeDisc(wrap);
      wrap.classList.add("is-flooding");      // solid flood, frayed rim only
      this.#cover(disc, x, y, page.accent, 0);   // start collapsed at the icon
      void disc.offsetWidth;   // commit that state before animating it

      // Hand the vortex centre to the arriving page, in viewport
      // fractions so it still lands right if the window was resized.
      try {
        sessionStorage.setItem(this.#WIPE_KEY,
          JSON.stringify({ x: x / innerWidth, y: y / innerHeight }));
      } catch { /* private mode — the flood still plays, just no dissipation */ }

      let gone = false;
      const go = () => { if (!gone) { gone = true; location.href = page.file; } };
      const px = x + this.#PAD;
      const py = y + this.#PAD;

      requestAnimationFrame(() => {
        disc.style.transition = "";
        disc.style.clipPath = `circle(${this.#radiusAt(x, y)}px at ${px}px ${py}px)`;
        disc.addEventListener("transitionend", go, { once: true });
      });
      setTimeout(go, this.#WIPE_MS + 500);   // safety net if transitionend is missed
    });
  }

  /** Landing back here from the history cache would otherwise restore
   *  the flood at full cover, hiding the page. */
  static resetWipe() {
    this.#readPending(true);
    this.#hideWipe();
  }

  // ── Build & mount ─────────────────────────────────────────
  static mount() {
    const logo = document.querySelector(".sidebar .app-logo");
    if (!logo || logo.closest(".logo-menu")) return;

    // Wrap the logo so a single :hover covers both the trigger and
    // the panel — no flicker when the pointer travels down.
    const wrap = document.createElement("div");
    wrap.className = "logo-menu";
    logo.parentNode.insertBefore(wrap, logo);
    wrap.appendChild(logo);

    const current = this.#currentId();

    // The sidebar logo shows this page's icon — the same markup the
    // switcher uses for it below.
    logo.innerHTML = this.#svg(current);

    const nav = document.createElement("nav");
    nav.className = "page-nav";
    nav.setAttribute("aria-label", "Switch page");

    for (const page of this.#PAGES) {
      nav.appendChild(this.#buildItem(page, page.id === current));
    }
    wrap.appendChild(nav);
  }

  static #buildItem(page, isCurrent) {
    const a = document.createElement("a");
    a.className = "page-nav-item" + (isCurrent ? " is-current" : "");
    a.href = page.file;
    a.dataset.page = page.id;   // lets the stylesheet target one page's icon
    // No title attribute: the label is already rendered as floating text,
    // and a title would pop the browser's own unstyled tooltip over it.
    a.setAttribute("aria-label", page.label);
    if (isCurrent) a.setAttribute("aria-current", "page");

    a.style.setProperty("--page-color", page.accent);
    a.style.setProperty("--page-glow", this.#tint(page.accent, .5));

    // Hover halo palette: the accent leads, the rest add iridescence.
    const glow = (page.glow && page.glow.length ? page.glow : [page.accent]);
    a.style.setProperty("--glow-1", glow[0]);
    a.style.setProperty("--glow-2", glow[1] || glow[0]);
    a.style.setProperty("--glow-3", glow[2] || glow[0]);

    const tile = document.createElement("span");
    tile.className = "page-nav-tile";
    tile.innerHTML = this.#svg(page.id);

    // Outer span runs the reveal transition, inner one the idle float —
    // keeping them apart stops the two transforms from fighting.
    const label = document.createElement("span");
    label.className = "page-nav-label";
    const inner = document.createElement("span");
    inner.textContent = page.label;
    label.appendChild(inner);

    a.append(tile, label);
    this.#installMorph(a);
    this.#installWipe(a, page);
    return a;
  }
}

// Cover the screen now, at parse time, if we arrived here via a flood —
// waiting for DOMContentLoaded risks a flash of the new page first.
PageNav.primeWipe();

// ── Auto-mount ────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    PageNav.mount();
    PageNav.playWipeIn();
  });
} else {
  PageNav.mount();
  PageNav.playWipeIn();
}

// Coming back from the history cache must not restore a full flood.
window.addEventListener("pageshow", (ev) => {
  if (ev.persisted) PageNav.resetWipe();
});
