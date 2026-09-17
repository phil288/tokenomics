import { esc, escUrl } from './format.js';

// Inner HTML for the self-update banner. Returns '' when up to date / unknown,
// so main.js can hide the element. Shown only when GitHub has a newer tag.
export function renderUpdateBanner(version) {
  if (!version || !version.update_available || !version.latest) return '';
  const latest = esc(version.latest);
  const current = version.current ? esc(version.current) : '?';
  const url = version.url || 'https://github.com/phil288/tokenomics/releases';
  return `
    <span class="ub-icon" aria-hidden="true">⬆</span>
    <span class="ub-text">Update available — <strong>${latest}</strong> is out (you're on ${current}).</span>
    <a class="ub-link" href="${escUrl(url)}" target="_blank" rel="noopener">Release notes →</a>
    <button class="ub-dismiss" id="update-dismiss" type="button" aria-label="Dismiss update notice">×</button>
  `;
}

// Inner HTML for the RTK/Headroom tool-update banner. Both tools are checked
// independently (src/tool-versions.js); this renders one row per tool that
// has a newer release, or '' when neither does.
export function renderToolUpdatesBanner(toolVersions) {
  if (!toolVersions) return '';
  const updates = Object.values(toolVersions).filter((t) => t && t.update_available && t.latest);
  if (!updates.length) return '';
  const rows = updates.map((t) => {
    const latest = esc(t.latest);
    const current = t.current ? esc(t.current) : '?';
    const label = esc(t.label || '');
    const url = t.url || '#';
    return `<span class="ub-row"><strong>${label}</strong> update available — <strong>${latest}</strong> is out (you're on ${current}). <a class="ub-link" href="${escUrl(url)}" target="_blank" rel="noopener">Release notes →</a></span>`;
  }).join('');
  return `
    <span class="ub-icon" aria-hidden="true">⬆</span>
    <span class="ub-text ub-rows">${rows}</span>
    <button class="ub-dismiss" id="tool-update-dismiss" type="button" aria-label="Dismiss update notice">×</button>
  `;
}

// Dedupe key for the tool-update dismissal so a further release (of either
// tool) re-shows the banner even after the user dismissed an older combo.
export function toolUpdatesDismissKey(toolVersions) {
  if (!toolVersions) return '';
  return Object.entries(toolVersions)
    .filter(([, t]) => t && t.update_available && t.latest)
    .map(([key, t]) => `${key}:${t.latest}`)
    .sort()
    .join(',');
}
