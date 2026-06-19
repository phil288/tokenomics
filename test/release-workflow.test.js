const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// The release pipeline is config, not app code, so assert its contract by
// reading the workflow file and checking the invariants that make it safe:
// triggers on main, derives the tag from package.json, is idempotent, gates
// on tests, and has permission to push the tag + create the release.
const wf = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');

test('release workflow is manual-only (workflow_dispatch)', () => {
  assert.match(wf, /workflow_dispatch:/);
  assert.doesNotMatch(wf, /^\s*push:/m);
});

test('release workflow derives the version from package.json', () => {
  assert.match(wf, /require\(['"]\.\/package\.json['"]\)\.version/);
});

test('release workflow is idempotent (skips when the tag already exists)', () => {
  assert.match(wf, /git ls-remote --exit-code --tags origin/);
  assert.match(wf, /exists == 'false'/);
});

test('release workflow gates on the test suite before tagging', () => {
  assert.match(wf, /node --test/);
});

test('release workflow can push tags and create releases', () => {
  assert.match(wf, /contents:\s*write/);
  assert.match(wf, /git push origin "\$TAG"/);
  assert.match(wf, /gh release create "\$TAG"/);
  assert.match(wf, /--generate-notes/);
});
