// ============ FREE-DRAG CARD LAYOUT ============
// Arrange mode lets cards be dragged anywhere in 2D; positions persist server-side
// in settings.CARD_LAYOUT ({ "<card-id>": {x, y, w} }). Native grid is untouched
// unless a layout is active. Free positioning only applies on wide viewports
// (>1100px, above the grid's first responsive breakpoint).
import { state } from './state.js';

const CARD_IDS = ['claude-card', 'hdr-card', 'rtk-card', 'cav-card', 'trends-card', 'cursor-card', 'antigravity-card'];
let arranging = false;

let board, arrangeBtn, resetLayoutBtn;

export const hasSavedLayout = () => Object.keys(state.cardLayout).length > 0;
const isVisible = (el) => el && el.style.display !== 'none';

// Replace the layout wholesale (server config is source of truth on load).
export function setCardLayout(layout) {
  state.cardLayout = layout || {};
}

// Apply current cardLayout to the DOM: switch board to free mode, position each
// visible card absolutely, and size the board to fit the lowest card.
export function applyLayout() {
  if (!board) return;
  board.classList.add('arranged');
  let maxBottom = 0;
  for (const id of CARD_IDS) {
    const el = document.getElementById(id);
    if (!isVisible(el)) continue;
    const pos = state.cardLayout[id];
    if (pos) {
      el.style.left = pos.x + 'px';
      el.style.top = pos.y + 'px';
      if (pos.w) el.style.width = pos.w + 'px';
      if (pos.h) el.style.height = pos.h + 'px';
    }
    if (isVisible(el)) maxBottom = Math.max(maxBottom, el.offsetTop + el.offsetHeight);
  }
  board.style.minHeight = maxBottom + 'px';
}

// Re-run after render() toggles visibility/content, but only when a layout is live.
export function reapplyCardLayout() {
  if (arranging || (hasSavedLayout() && board && board.classList.contains('arranged'))) {
    applyLayout();
  }
}

function recomputeBoardHeight() {
  if (!board) return;
  let maxBottom = 0;
  for (const id of CARD_IDS) {
    const el = document.getElementById(id);
    if (isVisible(el)) maxBottom = Math.max(maxBottom, el.offsetTop + el.offsetHeight);
  }
  board.style.minHeight = maxBottom + 'px';
}

// Capture the cards' current grid positions so toggling arrange mode doesn't jump them.
// Measure relative to the board (its rect), not offsetParent — before the board
// becomes position:relative the cards' offsetParent is the body, which would bake in
// the header+hero height and shove every card down.
function seedLayoutFromCurrent() {
  const boardRect = board.getBoundingClientRect();
  for (const id of CARD_IDS) {
    const el = document.getElementById(id);
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    state.cardLayout[id] = {
      x: Math.round(r.left - boardRect.left),
      y: Math.round(r.top - boardRect.top),
      w: Math.round(r.width)
    };
  }
}

async function persistLayout() {
  // instant local mirror (survives refresh even if the server write is in flight)
  try { localStorage.setItem('ltm-card-layout', JSON.stringify(state.cardLayout)); } catch { }
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ CARD_LAYOUT: state.cardLayout })
    });
  } catch (err) {
    console.error('Failed to save card layout:', err);
  }
}

let arrangeHintEl = null;
function showArrangeHint() {
  if (arrangeHintEl) return;
  arrangeHintEl = document.createElement('div');
  arrangeHintEl.className = 'arrange-hint';
  arrangeHintEl.textContent = '✥ Drag any card to move it · click ⇲ again to finish · ⤺ to reset';
  document.body.appendChild(arrangeHintEl);
}
function hideArrangeHint() {
  if (arrangeHintEl) { arrangeHintEl.remove(); arrangeHintEl = null; }
}

function enterArrange() {
  arranging = true;
  arrangeBtn.classList.add('active');
  resetLayoutBtn.style.display = '';
  if (!hasSavedLayout()) seedLayoutFromCurrent();
  applyLayout();
  board.classList.add('editing');
  showArrangeHint();
}

function exitArrange() {
  arranging = false;
  arrangeBtn.classList.remove('active');
  resetLayoutBtn.style.display = 'none';
  board.classList.remove('editing');
  hideArrangeHint();
  persistLayout();
}

function resetLayout() {
  state.cardLayout = {};
  try { localStorage.removeItem('ltm-card-layout'); } catch { }
  board.classList.remove('arranged', 'editing');
  board.style.minHeight = '';
  for (const id of CARD_IDS) {
    const el = document.getElementById(id);
    if (el) { el.style.left = ''; el.style.top = ''; el.style.width = ''; el.style.height = ''; }
  }
  arranging = false;
  arrangeBtn.classList.remove('active');
  resetLayoutBtn.style.display = 'none';
  hideArrangeHint();
  persistLayout();
}

// ---- pointer-driven drag + resize (mouse + touch, no library) ----
const MIN_W = 220, MIN_H = 120;
let drag = null;    // { el, id, dx, dy, boardRect }
let resize = null;  // { el, id, startX, startY, startW, startH }

// Build resize handles, grab DOM refs, and wire arrange/reset buttons + pointer
// events. Call once after the DOM is parsed.
export function initLayout() {
  board = document.querySelector('.board');
  arrangeBtn = document.getElementById('arrange-btn');
  resetLayoutBtn = document.getElementById('reset-layout-btn');

  // give every card a resize handle (hidden unless editing)
  for (const id of CARD_IDS) {
    const el = document.getElementById(id);
    if (el && !el.querySelector('.resize-handle')) {
      const h = document.createElement('div');
      h.className = 'resize-handle';
      h.title = 'Drag to resize';
      el.appendChild(h);
    }
  }

  arrangeBtn.addEventListener('click', () => {
    if (arranging) exitArrange(); else enterArrange();
  });
  resetLayoutBtn.addEventListener('click', resetLayout);

  board.addEventListener('pointerdown', (e) => {
    if (!arranging) return;
    const el = e.target.closest('.card');
    if (!el || !el.id || !CARD_IDS.includes(el.id)) return;

    // bottom-right handle → resize
    if (e.target.classList.contains('resize-handle')) {
      resize = {
        el, id: el.id,
        startX: e.clientX, startY: e.clientY,
        startW: el.offsetWidth, startH: el.offsetHeight
      };
      el.classList.add('dragging');
      board.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // ignore real controls so range buttons / explainer toggles still work
    if (e.target.closest('button, a, input, select, summary')) return;

    // anywhere else on the card → move
    const elRect = el.getBoundingClientRect();
    drag = {
      el, id: el.id,
      dx: e.clientX - elRect.left,
      dy: e.clientY - elRect.top,
      boardRect: board.getBoundingClientRect()
    };
    el.classList.add('dragging');
    board.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  board.addEventListener('pointermove', (e) => {
    if (resize) {
      const w = Math.max(MIN_W, resize.startW + (e.clientX - resize.startX));
      const h = Math.max(MIN_H, resize.startH + (e.clientY - resize.startY));
      resize.el.style.width = w + 'px';
      resize.el.style.height = h + 'px';
      return;
    }
    if (drag) {
      let x = e.clientX - drag.boardRect.left - drag.dx;
      let y = e.clientY - drag.boardRect.top - drag.dy;
      x = Math.max(0, Math.min(x, drag.boardRect.width - drag.el.offsetWidth));
      y = Math.max(0, y);
      drag.el.style.left = x + 'px';
      drag.el.style.top = y + 'px';
    }
  });

  board.addEventListener('pointerup', () => {
    const active = resize || drag;
    if (!active) return;
    active.el.classList.remove('dragging');
    const el = active.el;
    const prev = state.cardLayout[active.id] || {};
    state.cardLayout[active.id] = {
      x: parseFloat(el.style.left) || prev.x || 0,
      y: parseFloat(el.style.top) || prev.y || 0,
      w: Math.round(el.offsetWidth),
      h: resize ? Math.round(el.offsetHeight) : (prev.h || undefined)
    };
    drag = null;
    resize = null;
    recomputeBoardHeight();
    persistLayout();
  });
}
