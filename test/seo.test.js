const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// The public landing page (site/, deployed to GitHub Pages) is static config,
// so assert its SEO contract by reading the files: canonical URL, social cards,
// structured data, crawl files, and that the private dashboard stays noindex.
const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const SITE = 'https://phil288.github.io/tokenomics/';
const page = read('site', 'index.html');

test('landing page has title, description and canonical', () => {
  const title = page.match(/<title>([^<]+)<\/title>/)[1];
  assert.ok(title.length >= 30 && title.length <= 80, `title length ${title.length}`);
  const desc = page.match(/<meta name="description" content="([^"]+)"/)[1];
  assert.ok(desc.length >= 70 && desc.length <= 170, `description length ${desc.length}`);
  assert.match(page, new RegExp(`<link rel="canonical" href="${SITE}">`));
  assert.match(page, /<html lang="en">/);
  assert.equal((page.match(/<h1[\s>]/g) || []).length, 1, 'exactly one h1');
});

test('landing page has Open Graph and Twitter cards pointing at a real image', () => {
  for (const p of ['og:title', 'og:description', 'og:url', 'og:image', 'og:type'])
    assert.match(page, new RegExp(`property="${p}"`), p);
  assert.match(page, /name="twitter:card" content="summary_large_image"/);
  assert.match(page, new RegExp(`property="og:image" content="${SITE}og-image.png"`));
  assert.ok(fs.existsSync(path.join(root, 'site', 'og-image.png')));
  assert.ok(fs.existsSync(path.join(root, 'site', 'dashboard.png')));
});

test('landing page JSON-LD blocks parse and describe the app', () => {
  const blocks = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(m => JSON.parse(m[1]));
  const app = blocks.find(b => b['@type'] === 'SoftwareApplication');
  assert.ok(app);
  assert.equal(app.name, 'Tokenomics');
  assert.equal(app.url, SITE);
  assert.equal(app.offers.price, '0');
  const faq = blocks.find(b => b['@type'] === 'FAQPage');
  assert.ok(faq && faq.mainEntity.length > 0);
  // Google requires FAQ structured data to match visible content.
  for (const q of faq.mainEntity) assert.ok(page.includes(`<dt>${q.name}</dt>`), q.name);
});

test('every image on the landing page has alt text', () => {
  for (const img of page.match(/<img\b[^>]*>/g) || []) assert.match(img, /\balt="[^"]+"/);
});

test('robots.txt, sitemap.xml and llms.txt are consistent', () => {
  const robots = read('site', 'robots.txt');
  assert.match(robots, /Allow: \//);
  assert.match(robots, new RegExp(`Sitemap: ${SITE}sitemap.xml`));
  assert.match(read('site', 'sitemap.xml'), new RegExp(`<loc>${SITE}</loc>`));
  assert.match(read('site', 'llms.txt'), /^# Tokenomics\n\n> /);
});

test('pages workflow deploys site/ to GitHub Pages', () => {
  const wf = read('.github', 'workflows', 'pages.yml');
  assert.match(wf, /pages:\s*write/);
  assert.match(wf, /id-token:\s*write/);
  assert.match(wf, /path:\s*site/);
  assert.match(wf, /actions\/deploy-pages@/);
});

test('package.json carries npm discovery metadata', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.homepage, SITE);
  assert.match(pkg.repository.url, /github\.com\/phil288\/tokenomics/);
  assert.ok(pkg.bugs.url);
  for (const k of ['claude-code', 'cursor', 'token-usage', 'rtk', 'headroom', 'caveman'])
    assert.ok(pkg.keywords.includes(k), k);
  assert.deepEqual(pkg.dependencies, {}, 'still zero runtime deps');
});

test('the running dashboard is never indexed', () => {
  assert.match(read('index.html'), /<meta name="robots" content="noindex, nofollow">/);
});
