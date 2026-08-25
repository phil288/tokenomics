const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('provider visibility is applied across every Overview surface', () => {
  const html = read('index.html');
  const main = read('src/web/main.js');
  const settings = read('src/web/settings.js');
  const hero = read('src/web/cards-core.js');
  const common = read('src/web/cards-common.js');
  const charts = read('src/web/charts.js');

  for (const id of [
    'rtk-card', 'cav-card', 'claude-card', 'hdr-card',
    'cursor-card', 'antigravity-card',
  ]) {
    assert.match(main, new RegExp(`setCard\\('${id}'`), `${id} must follow provider visibility`);
  }
  assert.doesNotMatch(main, /setCard\('trends-card'/,
    'dashboard-level Trends must not be hidden with provider cards');

  assert.match(settings, /try \{\s*applySavedProviderVisibility\(result\.settings \|\| body\)/,
    'saved visibility should apply before the follow-up stats refresh');
  assert.match(settings, /Failed to apply saved provider visibility/,
    'presentation failures must not be reported as settings persistence failures');
  assert.match(settings, /applySavedProviderVisibility\(config\)/,
    'initial settings load should hide disabled providers before applying a saved layout');

  assert.match(html, /id="hero-sources"/);
  assert.match(html, /id="history-saved-sources"/);
  assert.match(html, /id="headroom-cost-trend"/);

  assert.match(hero, /stats\.visibility \|\| \{\}/);
  assert.match(hero, /\.filter\(source => visibility\[source\.key\] !== false\)/);
  assert.match(hero, /heroUsers\(stats\.users \|\| \[\], visibility\)/);

  for (const source of ['rtk', 'caveman', 'headroom']) {
    assert.match(common, new RegExp(`visibility\\.${source} !== false`),
      `per-user hero totals must exclude disabled ${source}`);
  }

  assert.match(charts, /enabledSavedSources[\s\S]*\.filter\(source => visibility\[source\.key\] !== false\)/);
  assert.match(charts, /headroomCostTrend\.style\.display = ''/);
  assert.match(charts, /drawLine\('hc-cost'/,
    'cost history should remain visible independently of the Headroom card toggle');
});
