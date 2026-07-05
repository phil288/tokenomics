// ============ FREE-DRAG CARD LAYOUT ============
// Arrange mode (the ⇲ toolbar toggle) lets panels be dragged anywhere in 2D and
// resized; positions persist server-side. Two independent surfaces share the one
// toggle and the exact same behavior:
//   • the Overview board  — `.card`s on `.board`      → settings.CARD_LAYOUT
//   • the Analysis view   — `.an-block`s in each `.an-grid` → settings.ANALYSIS_LAYOUT
// Both layout maps are flat { "<element-id>": {x, y, w, h} } (element ids are
// unique across surfaces). Native grid is untouched unless a layout is active.
import { state } from './state.js';

const CARD_IDS = ['claude-card', 'hdr-card', 'rtk-card', 'cav-card', 'trends-card', 'cursor-card', 'antigravity-card'];
let arranging = false;

let arrangeBtn, resetLayoutBtn;

// A "board" is any container whose direct children are freely positioned.
// Overview is one board; each analysis section grid is another. Built live from
// the DOM so it always reflects the current view.
function boards() {
  const list = [];
  const overview = document.querySelector('.board');
  if (overview) list.push({ el: overview, which: 'card', ids: () => CARD_IDS });
  for (const grid of document.querySelectorAll('#view-analysis .an-grid')) {
    list.push({
      el: grid, which: 'analysis',
      ids: () => [...grid.querySelectorAll(':scope > .an-block')].map(b => b.id).filter(Boolean),
    });
  }
  return list;
}

const mapFor = (which) => which === 'analysis' ? state.analysisLayout : state.cardLayout;
// A board is only actionable when it's actually on screen (its view is active);
// a hidden view's children have no offsetParent, so measuring them is meaningless.
const boardVisible = (el) => !!(el && el.offsetParent !== null);
const isVisible = (el) => el && el.offsetParent !== null && el.style.display !== 'none';

export const hasSavedLayout = () => Object.keys(state.cardLayout).length > 0;
const boardHasSaved = (b) => b.ids().some(id => mapFor(b.which)[id]);

// Source of truth on load comes from the server config.
export function setCardLayout(layout) { state.cardLayout = layout || {}; }
export function setAnalysisLayout(layout) {
  state.analysisLayout = layout || {};
  // Settings load lands after initLayout(); re-apply to any visible analysis board.
  applyLayout();
}

// Position one board's children absolutely from its layout map, and size the
// board to fit the lowest child.
function applyBoard(b) {
  const map = mapFor(b.which);
  b.el.classList.add('arranged');
  let maxBottom = 0;
  for (const id of b.ids()) {
    const el = document.getElementById(id);
    if (!isVisible(el)) continue;
    const pos = map[id];
    if (pos) {
      el.style.left = pos.x + 'px';
      el.style.top = pos.y + 'px';
      if (pos.w) el.style.width = pos.w + 'px';
      if (pos.h) el.style.height = pos.h + 'px';
    }
    maxBottom = Math.max(maxBottom, el.offsetTop + el.offsetHeight);
  }
  b.el.style.minHeight = maxBottom + 'px';
}

// Apply saved/active layouts to every visible board.
export function applyLayout() {
  for (const b of boards()) {
    if (!boardVisible(b.el)) continue;
    if (arranging || boardHasSaved(b)) applyBoard(b);
  }
}

// Re-run after render()/view-switch toggles visibility, but only when a layout is
// live. While arranging, seed a newly-shown board so switching views keeps working.
export function reapplyCardLayout() {
  for (const b of boards()) {
    if (!boardVisible(b.el)) continue;
    if (arranging) {
      if (!boardHasSaved(b)) seedBoard(b);
      applyBoard(b);
      b.el.classList.add('editing');
    } else if (boardHasSaved(b)) {
      // Apply a saved layout the first time its view becomes visible (e.g.
      // switching to the Analysis tab after load).
      applyBoard(b);
    }
  }
}

function recomputeBoardHeight(b) {
  let maxBottom = 0;
  for (const id of b.ids()) {
    const el = document.getElementById(id);
    if (isVisible(el)) maxBottom = Math.max(maxBottom, el.offsetTop + el.offsetHeight);
  }
  b.el.style.minHeight = maxBottom + 'px';
}

// Capture a board's children's current (grid) positions so toggling arrange mode
// doesn't jump them. Measure relative to the board's rect, not offsetParent.
function seedBoard(b) {
  const map = mapFor(b.which);
  const rect = b.el.getBoundingClientRect();
  for (const id of b.ids()) {
    const el = document.getElementById(id);
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    map[id] = {
      x: Math.round(r.left - rect.left),
      y: Math.round(r.top - rect.top),
      w: Math.round(r.width),
    };
  }
}

async function persistLayout() {
  try { localStorage.setItem('ltm-card-layout', JSON.stringify(state.cardLayout)); } catch { }
  try { localStorage.setItem('ltm-analysis-layout', JSON.stringify(state.analysisLayout)); } catch { }
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ CARD_LAYOUT: state.cardLayout, ANALYSIS_LAYOUT: state.analysisLayout }),
    });
  } catch (err) {
    console.error('Failed to save layout:', err);
  }
}

let arrangeHintEl = null;
function showArrangeHint() {
  if (arrangeHintEl) return;
  arrangeHintEl = document.createElement('div');
  arrangeHintEl.className = 'arrange-hint';
  arrangeHintEl.textContent = '✥ Drag any panel to move it · drag its corner to resize · click ⇲ again to finish · ⤺ to reset';
  document.body.appendChild(arrangeHintEl);
}
function hideArrangeHint() {
  if (arrangeHintEl) { arrangeHintEl.remove(); arrangeHintEl = null; }
}

function enterArrange() {
  arranging = true;
  arrangeBtn.classList.add('active');
  resetLayoutBtn.style.display = '';
  const bs = boards();
  // Pass 1: seed EVERY visible board while all panels are still in native grid
  // flow. applyBoard() makes a grid's children absolute and collapses it, which
  // shifts later grids — so measuring must finish before any board is mutated,
  // else later boards seed against a corrupted layout (panels pile up at 0,0).
  for (const b of bs) {
    if (boardVisible(b.el) && !boardHasSaved(b)) seedBoard(b);
  }
  // Pass 2: now apply absolute positioning + drag affordance.
  for (const b of bs) {
    if (boardVisible(b.el)) applyBoard(b);
    b.el.classList.add('editing'); // affordance persists when its view is shown
  }
  showArrangeHint();
}

function exitArrange() {
  arranging = false;
  arrangeBtn.classList.remove('active');
  resetLayoutBtn.style.display = 'none';
  for (const b of boards()) b.el.classList.remove('editing');
  hideArrangeHint();
  persistLayout();
}

function resetLayout() {
  state.cardLayout = {};
  state.analysisLayout = {};
  try { localStorage.removeItem('ltm-card-layout'); localStorage.removeItem('ltm-analysis-layout'); } catch { }
  for (const b of boards()) {
    b.el.classList.remove('arranged', 'editing');
    b.el.style.minHeight = '';
    for (const id of b.ids()) {
      const el = document.getElementById(id);
      if (el) { el.style.left = ''; el.style.top = ''; el.style.width = ''; el.style.height = ''; }
    }
  }
  arranging = false;
  arrangeBtn.classList.remove('active');
  resetLayoutBtn.style.display = 'none';
  hideArrangeHint();
  persistLayout();
}

// ---- pointer-driven drag + resize (mouse + touch, no library) ----
const MIN_W = 220, MIN_H = 120;
let drag = null;    // { el, board, dx, dy, boardRect }
let resize = null;  // { el, board, startX, startY, startW, startH }

// Attach drag/resize handlers to one board element (closure over its descriptor).
function wireBoard(b) {
  const el0 = b.el;
  const childOf = (target) => {
    const child = b.which === 'card' ? target.closest('.card') : target.closest('.an-block');
    if (!child || !child.id || !b.ids().includes(child.id)) return null;
    return child;
  };

  el0.addEventListener('pointerdown', (e) => {
    if (!arranging) return;
    const el = childOf(e.target);
    if (!el) return;

    if (e.target.classList.contains('resize-handle')) {
      resize = { el, board: b, startX: e.clientX, startY: e.clientY, startW: el.offsetWidth, startH: el.offsetHeight };
      el.classList.add('dragging');
      el0.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    // ignore real controls so toggles / links still work while arranging
    if (e.target.closest('button, a, input, select, summary')) return;

    const elRect = el.getBoundingClientRect();
    drag = { el, board: b, dx: e.clientX - elRect.left, dy: e.clientY - elRect.top, boardRect: el0.getBoundingClientRect() };
    el.classList.add('dragging');
    el0.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  el0.addEventListener('pointermove', (e) => {
    if (resize && resize.board === b) {
      resize.el.style.width = Math.max(MIN_W, resize.startW + (e.clientX - resize.startX)) + 'px';
      resize.el.style.height = Math.max(MIN_H, resize.startH + (e.clientY - resize.startY)) + 'px';
      return;
    }
    if (drag && drag.board === b) {
      let x = e.clientX - drag.boardRect.left - drag.dx;
      let y = e.clientY - drag.boardRect.top - drag.dy;
      x = Math.max(0, Math.min(x, drag.boardRect.width - drag.el.offsetWidth));
      y = Math.max(0, y);
      drag.el.style.left = x + 'px';
      drag.el.style.top = y + 'px';
    }
  });

  const finish = () => {
    const active = (resize && resize.board === b) ? resize : (drag && drag.board === b) ? drag : null;
    if (!active) return;
    active.el.classList.remove('dragging');
    const el = active.el;
    const map = mapFor(b.which);
    const prev = map[el.id] || {};
    map[el.id] = {
      x: parseFloat(el.style.left) || prev.x || 0,
      y: parseFloat(el.style.top) || prev.y || 0,
      w: Math.round(el.offsetWidth),
      h: (active === resize) ? Math.round(el.offsetHeight) : (prev.h || undefined),
    };
    drag = null; resize = null;
    recomputeBoardHeight(b);
    persistLayout();
  };
  el0.addEventListener('pointerup', finish);
  el0.addEventListener('pointercancel', finish);
}

// Inject a resize handle into every draggable child of a board (idempotent).
function addResizeHandles(b) {
  const sel = b.which === 'card' ? null : '.an-block';
  const children = b.which === 'card'
    ? b.ids().map(id => document.getElementById(id))
    : [...b.el.querySelectorAll(sel)];
  for (const el of children) {
    if (el && !el.querySelector(':scope > .resize-handle')) {
      const h = document.createElement('div');
      h.className = 'resize-handle';
      h.title = 'Drag to resize';
      el.appendChild(h);
    }
  }
}

// Build resize handles, wire arrange/reset buttons + pointer events. Call once
// after the DOM is parsed. Analysis boards are wired here too; they simply do
// nothing until the Analysis view is visible and arrange mode is on.
export function initLayout() {
  arrangeBtn = document.getElementById('arrange-btn');
  resetLayoutBtn = document.getElementById('reset-layout-btn');

  for (const b of boards()) { addResizeHandles(b); wireBoard(b); }

  arrangeBtn.addEventListener('click', () => { if (arranging) exitArrange(); else enterArrange(); });
  resetLayoutBtn.addEventListener('click', resetLayout);

  // Switching to a view while arranging must seed/show its board; the analysis
  // module emits 'viewchange', and render() calls reapplyCardLayout() too.
  window.addEventListener('viewchange', () => reapplyCardLayout());
}

// True while arrange mode is on — analysis.js uses it to suppress table sorting
// during a drag.
export const isArranging = () => arranging;
