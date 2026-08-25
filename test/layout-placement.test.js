const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadPlacementModule() {
  const file = path.join(__dirname, '..', 'src', 'web', 'layout-placement.js');
  const source = fs.readFileSync(file, 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const overlaps = (a, b, gap = 16) =>
  a.x < b.x + b.w + gap
  && a.x + a.w + gap > b.x
  && a.y < b.y + b.h + gap
  && a.y + a.h + gap > b.y;

test('newly enabled provider widgets receive distinct non-overlapping positions', async () => {
  const { findOpenPosition } = await loadPlacementModule();
  const occupied = [
    { x: 10, y: 0, w: 538, h: 440 },
    { x: 570, y: 0, w: 1295, h: 610 },
  ];

  for (let i = 0; i < 4; i++) {
    const position = findOpenPosition({
      boardWidth: 1875,
      width: 538,
      height: 300,
      occupied,
    });
    const placed = { ...position, w: 538, h: 300 };
    assert.ok(occupied.every(rect => !overlaps(placed, rect)), `widget ${i + 1} must not overlap`);
    assert.ok(placed.x >= 0 && placed.x + placed.w <= 1875, `widget ${i + 1} must fit the board`);
    occupied.push(placed);
  }

  assert.equal(new Set(occupied.slice(2).map(rect => `${rect.x},${rect.y}`)).size, 4);
});

test('placement falls back below occupied content on a narrow board', async () => {
  const { findOpenPosition } = await loadPlacementModule();
  const occupied = [{ x: 0, y: 0, w: 320, h: 240 }];
  assert.deepEqual(
    findOpenPosition({ boardWidth: 320, width: 320, height: 180, occupied }),
    { x: 0, y: 256 },
  );
});

test('layout keeps saved cards on their row when the viewport changes', () => {
  const layout = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'layout.js'), 'utf8');
  assert.match(layout, /const viewportWidth = document\.documentElement\?\.clientWidth \|\| window\.innerWidth/);
  assert.match(layout, /Keep saved cards on their saved row/);
  assert.match(layout, /Number\(pos\.x\) \+ width <= boardWidth/);
  assert.match(layout, /Number\(pos\.x\) \+ width > boardWidth/);
  assert.match(layout, /const missing = visible\.filter\(el => !map\[el\.id\]\)/,
    'only new widgets should receive collision-based placement');
  assert.match(layout, /const x = Math\.max\(0, Math\.min\(Number\(pos\.x\)/,
    'saved cards should be clamped horizontally instead of moved vertically');
});

test('overview grid tracks can shrink without forcing horizontal overflow', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'index.css'), 'utf8');
  assert.match(css, /\.board\s*\{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.board > \.card\s*\{[\s\S]*min-width: 0/);
});

test('layout integration reserves saved positions for currently hidden cards', () => {
  const layout = fs.readFileSync(path.join(__dirname, '..', 'src', 'web', 'layout.js'), 'utf8');
  assert.match(layout, /const elements = b\.ids\(\)[\s\S]*const visible = elements/);
  assert.match(layout, /const occupied = elements\.flatMap/,
    'collision checks must include hidden cards that already own saved positions');
  assert.match(layout, /clone\.style\.visibility = 'hidden'/,
    'hidden cards should be measured off-screen without flashing into view');
});
