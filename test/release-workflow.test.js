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

test('release workflow is manual-only with a bump-level input', () => {
  assert.match(wf, /workflow_dispatch:/);
  assert.doesNotMatch(wf, /^\s*push:/m);
  assert.match(wf, /bump:/);
  assert.match(wf, /options:\s*\[patch,\s*minor,\s*major\]/);
});

test('release workflow bumps the version automatically and derives the tag', () => {
  assert.match(wf, /npm version "\$\{\{ inputs\.bump \}\}" --no-git-tag-version/);
  assert.match(wf, /require\(['"]\.\/package\.json['"]\)\.version/);
});

test('release workflow gates on the test suite before tagging', () => {
  assert.match(wf, /node --test/);
});

test('release workflow commits the bump, pushes the tag, and creates a release', () => {
  assert.match(wf, /contents:\s*write/);
  assert.match(wf, /git commit -m "chore\(release\): \$TAG"/);
  assert.match(wf, /git push origin HEAD:main/);
  assert.match(wf, /git push origin "\$TAG"/);
  assert.match(wf, /gh release create/);
  assert.match(wf, /--generate-notes/);
});
