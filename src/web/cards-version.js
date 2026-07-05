import { ht } from './format.js';

// Inner HTML for the self-update banner. Returns '' when up to date / unknown,
// so main.js can hide the element. Shown only when GitHub has a newer tag.
export function renderUpdateBanner(version) {
  if (!version || !version.update_available || !version.latest) return '';
  const latest = ht(version.latest);
  const current = version.current ? ht(version.current) : '?';
  const url = version.url || 'https://github.com/phil288/tokenomics/releases';
  return `
    <span class="ub-icon" aria-hidden="true">⬆</span>
    <span class="ub-text">Update available — <strong>${latest}</strong> is out (you're on ${current}).</span>
    <a class="ub-link" href="${ht(url)}" target="_blank" rel="noopener">Release notes →</a>
    <button class="ub-dismiss" id="update-dismiss" type="button" aria-label="Dismiss update notice">×</button>
  `;
}
