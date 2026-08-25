// Overview board structure: the three LLM usage cards sit across the top, one
// per column, with everything else in three columns underneath. Pure front-end
// DOM (no jsdom — zero-dependency rule), so the HTML/CSS contract is asserted by
// reading the files.
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const HTML = read('index.html');
const CSS = read('index.css');
const LAYOUT_JS = read('src/web/layout.js');

// The board's markup, from `<div class="board">` to its closing marker comment.
const BOARD = HTML.slice(HTML.indexOf('<div class="board">'), HTML.indexOf('<!-- /Tab: overview -->'));

test('the three quota cards are direct children of the board, in column order', () => {
  const direct = [...BOARD.matchAll(/^ {4}<div class="card[^"]*" id="([^"]+)"/gm)].map(m => m[1]);
  assert.deepEqual(direct, ['claude-card', 'cursor-card', 'antigravity-card']);
});

// Cards between one column's opening tag and the next column's (or the board's end).
function colCards(cls) {
  const start = BOARD.indexOf(`class="board-col ${cls}"`);
  assert.notEqual(start, -1, `${cls} column missing`);
  const next = BOARD.indexOf('class="board-col ', start + 20);
  const body = BOARD.slice(start, next === -1 ? BOARD.length : next);
  return [...body.matchAll(/id="([a-z-]+-card)"/g)].map(m => m[1]);
}

test('the remaining cards live in the three columns below', () => {
  assert.deepEqual(colCards('bcol-1'), ['rtk-card', 'cav-card']);
  assert.deepEqual(colCards('bcol-2'), ['hdr-card']);
  assert.deepEqual(colCards('bcol-3'), ['trends-card']);
});

test('the board is a 3-column grid with the top row pinned explicitly', () => {
  const board = CSS.slice(CSS.indexOf('.board {'), CSS.indexOf('.board-col {'));
  assert.match(board, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  // Hiding a disabled quota card must not pull a lower column into the top row,
  // so each top card and each column is placed by hand on wide viewports.
  const pinned = CSS.slice(CSS.indexOf('@media (min-width: 1101px)'), CSS.indexOf('@media (max-width: 1100px)'));
  for (const [sel, area] of [
    ['#claude-card', '1 / 1'], ['#cursor-card', '1 / 2'], ['#antigravity-card', '1 / 3'],
    ['.bcol-1', '2 / 1'], ['.bcol-2', '2 / 2'], ['.bcol-3', '2 / 3'],
  ]) {
    assert.match(pinned, new RegExp(`\\.board > \\${sel.startsWith('#') ? '#' : '.'}${sel.slice(1)}\\s*\\{ grid-area: ${area}; \\}`), `${sel} not pinned`);
  }
});

test('narrow viewports fall back to auto placement', () => {
  assert.match(CSS, /@media \(max-width: 1100px\) \{\s*\.board \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(CSS, /@media \(max-width: 680px\) \{\s*\.board \{\s*grid-template-columns: minmax\(0, 1fr\);/);
});

test('a saved free-drag layout is untouched by the reordering', () => {
  // One board element, positions keyed by card id and applied absolutely — so
  // moving a card in the markup cannot shift a user's saved arrangement.
  assert.equal((HTML.match(/class="board"/g) || []).length, 1);
  assert.match(LAYOUT_JS, /document\.querySelector\('\.board'\)/);
  assert.match(LAYOUT_JS, /const CARD_IDS = \[[^\]]*'cursor-card'[^\]]*'antigravity-card'[^\]]*\]/);
  // .board-col collapses in arrange mode, so nesting depth never affects layout
  assert.match(CSS, /\.board\.arranged \.board-col \{\s*display: contents;/);
});
