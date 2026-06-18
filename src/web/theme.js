// ---- theme (dark / light / auto) ----
import { redrawAllCharts } from './charts.js';

function applyTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  try { localStorage.setItem('ltm-theme', mode); } catch { }
  document.querySelectorAll('#theme-toggle button').forEach(b =>
    b.classList.toggle('active', b.dataset.themeVal === mode));
  redrawAllCharts();
}

export function initTheme() {
  let saved = 'auto';
  try { saved = localStorage.getItem('ltm-theme') || 'auto'; } catch { }
  document.documentElement.setAttribute('data-theme', saved);
  document.querySelectorAll('#theme-toggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.themeVal === saved);
    b.addEventListener('click', () => applyTheme(b.dataset.themeVal));
  });
  // when in auto mode, repaint charts if the OS theme flips
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if ((document.documentElement.getAttribute('data-theme')) === 'auto') redrawAllCharts();
    });
  }
}
