// ============ FREE-DRAG CARD LAYOUT ============
// Arrange mode (the ⇲ toolbar toggle) lets panels be dragged anywhere in 2D and
// resized; positions persist server-side. Two independent surfaces share the one
// toggle and the exact same behavior:
//   • the Overview board  — `.card`s on `.board`      → settings.CARD_LAYOUT
//   • the Analysis view   — `.an-block`s in each `.an-grid` → settings.ANALYSIS_LAYOUT
// Both layout maps are flat { "<element-id>": {x, y, w, h} } (element ids are
// unique across surfaces). Native grid is untouched unless a layout is active.
import { state } from './state.js';
import { findOpenPosition } from './layout-placement.js';

const CARD_IDS = ['claude-card', 'hdr-card', 'rtk-card', 'cav-card', 'trends-card', 'cursor-card', 'antigravity-card'];
const MIN_W = 220, MIN_H = 120;
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

// A saved layout can be partial when a provider was disabled while positions
// were captured. When that provider is enabled later, assign every newly
// visible card a collision-free slot before absolute positioning is applied.
// Otherwise all unmapped cards share the same CSS static position and overlap.
function placeUnmappedVisible(b) {
  const map = mapFor(b.which);
  const elements = b.ids()
    .map(id => document.getElementById(id))
    .filter(Boolean);
  const visible = elements
    .filter(isVisible);
  const boardRect = b.el.getBoundingClientRect();
  const measuredWidth = b.el.clientWidth || boardRect.width || MIN_W;
  const viewportWidth = document.documentElement?.clientWidth || window.innerWidth || measuredWidth;
  const availableWidth = Math.max(1, viewportWidth - boardRect.left);
  const boardWidth = Math.min(measuredWidth, availableWidth);
  const columnWidth = Math.max(MIN_W, Math.floor((boardWidth - 32) / 3));
  const positionWidth = el => Number(map[el.id]?.w) || el.offsetWidth || columnWidth;
  const fitsBoard = el => {
    const pos = map[el.id];
    if (!pos) return false;
    const width = positionWidth(el);
    return Number(pos.x) >= 0 && Number(pos.x) + width <= boardWidth;
  };

  // Keep saved cards on their saved row. If a viewport change makes one wider
  // than the available board or pushes it past the right edge, clamp only its
  // width/x. Sending it through findOpenPosition() would move it to the bottom
  // after every refresh, even when its original top-row position is usable.
  let changed = false;
  for (const el of visible) {
    const pos = map[el.id];
    if (!pos || fitsBoard(el)) continue;
    const savedWidth = Number(pos.w);
    const width = Number.isFinite(savedWidth) && savedWidth > 0
      ? Math.min(boardWidth, savedWidth)
      : Math.min(boardWidth, el.offsetWidth || columnWidth);
    const x = Math.max(0, Math.min(Number(pos.x) || 0, Math.max(0, boardWidth - width)));
    if (x !== Number(pos.x) || width !== savedWidth) {
      map[el.id] = { ...pos, x: Math.round(x), w: Math.round(width) };
      changed = true;
    }
  }

  // Only widgets without a saved position are placed into a new slot.
  const missing = visible.filter(el => !map[el.id]);
  if (!missing.length) return changed;

  const mappedWidths = elements
    .map(el => map[el.id] && Number(map[el.id].w))
    .filter(width => Number.isFinite(width) && width >= MIN_W);
  const autoWidth = Math.min(boardWidth, mappedWidths.length ? Math.min(columnWidth, ...mappedWidths) : columnWidth);
  const widthFor = el => {
    return autoWidth;
  };
  const measureHeight = (el, width) => {
    const liveHeight = el.offsetHeight || el.scrollHeight;
    if (liveHeight) return Math.max(MIN_H, liveHeight);
    const clone = el.cloneNode(true);
    clone.removeAttribute('id');
    clone.style.position = 'absolute';
    clone.style.visibility = 'hidden';
    clone.style.pointerEvents = 'none';
    clone.style.display = 'block';
    clone.style.left = '-10000px';
    clone.style.top = '0';
    clone.style.width = width + 'px';
    clone.style.height = 'auto';
    document.body.appendChild(clone);
    const height = Math.max(MIN_H, clone.offsetHeight || clone.scrollHeight || MIN_H);
    clone.remove();
    return height;
  };
  // Reserve positions belonging to hidden cards too. Otherwise an unmapped
  // card can be placed into a disabled card's slot and overlap it later.
  const occupied = elements.flatMap(el => {
    const pos = map[el.id];
    if (!pos) return [];
    const width = Number(pos.w) || el.offsetWidth || autoWidth;
    if (Number(pos.x) < 0 || Number(pos.x) + width > boardWidth) return [];
    return [{
      x: Number(pos.x) || 0,
      y: Number(pos.y) || 0,
      w: width,
      h: Number(pos.h) || measureHeight(el, width),
    }];
  });

  for (const el of missing) {
    const width = widthFor(el);
    el.style.width = width + 'px';
    const height = measureHeight(el, width);
    const { x, y } = findOpenPosition({
      boardWidth,
      width,
      height,
      occupied,
    });
    const savedHeight = Number(map[el.id]?.h);
    map[el.id] = {
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(width),
      ...(Number.isFinite(savedHeight) ? { h: savedHeight } : {}),
    };
    occupied.push({ x, y, w: width, h: height });
  }
  return true;
}

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
  let changed = false;
  for (const b of boards()) {
    if (!boardVisible(b.el)) {
      continue;
    }

    if (arranging || boardHasSaved(b)) {
      if (boardHasSaved(b)) {
        changed = placeUnmappedVisible(b) || changed;
      }

      applyBoard(b);
    }
  }

  if (changed) {
    persistLayout();
  }
}

// Re-run after render()/view-switch toggles visibility, but only when a layout is
// live. While arranging, seed a newly-shown board so switching views keeps working.
export function reapplyCardLayout() {
  let changed = false;
  for (const b of boards()) {
    if (!boardVisible(b.el)) continue;
    if (arranging) {
      if (!boardHasSaved(b)) {
        seedBoard(b);
      } else {
        changed = placeUnmappedVisible(b) || changed;
      }
      applyBoard(b);
      b.el.classList.add('editing');
    } else if (boardHasSaved(b)) {
      // Apply a saved layout the first time its view becomes visible (e.g.
      // switching to the Analysis tab after load).
      changed = placeUnmappedVisible(b) || changed;
      applyBoard(b);
    }
  }
  if (changed) persistLayout();
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
