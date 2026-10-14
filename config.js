/**
 * Daily Studio — Configuration
 * Edit this file to change theme, accent color, and app behavior.
 * Changes take effect on next page load.
 */
const CONFIG = {

  // ── Appearance ────────────────────────────────────────────
  // theme: "light" | "dark"
  theme: "light",

  // Primary accent color (buttons, links, highlights)
  accent: "#0d9488",           // teal-600

  // Sidebar width (any CSS value)
  sidebarWidth: "280px",

  // ── Content ───────────────────────────────────────────────
  appName: "Daily Studio",
  userName: "",                 // leave empty to hide greeting name

  // ── Clock ─────────────────────────────────────────────────
  clockFormat: "24h",           // "24h" | "12h"

  // ── Todo ──────────────────────────────────────────────────
  todoStorageKey: "ds_todos",        // localStorage key for inbox tasks
  todoPlaceholder: "What needs to be done?",
  todoMaxItems: 99,                  // soft cap (just a warning, not enforced)

  // ── Calendar ──────────────────────────────────────────────
  calendarStorageKey: "ds_calendar", // localStorage key for calendar tasks
  weekStart: 0,                      // 0 = Sunday, 1 = Monday
  calCellMaxDots: 4,                 // max priority dots per day cell

  // ── Quick Links ───────────────────────────────────────────
  quicklinksStorageKey: "ds_quicklinks",  // localStorage key
  quicklinksMaxItems: 50,

  // ── Work Log ──────────────────────────────────────────────
  worklogStorageKey: "ds_worklog",       // localStorage key for Markdown work log

  // ── Long-Term Tasks ─────────────────────────────────────
  longtermStorageKey: "ds_longterm",  // localStorage key
  longtermMaxDepth: 5,                // max tree depth (root = level 0)

  // ── Secondary Pages ───────────────────────────────────────
  // admin.html / docs.html reuse the sidebar but drop the work-log
  // and task modules. Each runs its own accent color.
  adminAccent: "#2f6fed",             // indigo-600 — deep-navy admin page
  adminBadge:  "Admin",               // label shown next to the app title
  docsAccent:  "#8f3a44",             // wine — walnut/parchment docs page
  docsBadge:   "Docs",                // label shown next to the app title

  // Hover glow behind a switcher icon. The page's own accent leads;
  // the two following hues add iridescence around it.
  glow:       ["#0d9488", "#2dd4bf", "#38bdf8"],   // teal · aqua · sky
  adminGlow:  ["#2f6fed", "#7c5cff", "#38bdf8"],   // indigo · violet · sky
  docsGlow:   ["#8f3a44", "#c9722f", "#e0b062"],   // wine · amber · brass

  // ── Page Transition ───────────────────────────────────────
  // The accent flood that swallows the page when switching. Toggled
  // from the admin page; the flag lives in localStorage.
  wipeEnabledKey: "ds_wipe_enabled",
  wipeEnabled: true,                  // used until the toggle is touched

  // ── Extensions (future) ───────────────────────────────────
  // Add your own keys here when extending the app.
  // Components read their settings from CONFIG.xxx.
};
