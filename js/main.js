import { POPULAR_CURRENCIES, fetchRates, getDisplayCurrency, symOf, updateRatesStatus } from './currency.js';
import { getActiveBom, saveData, state, loadDataAsync } from './data.js';
import { openBomModal, openItemModal, openSettingsModal } from './ui/modals.js';
import { openBomPickerModal, renderAll } from './ui/render.js';
import { checkShareParam, exportCSV, triggerCSVImport } from './utils.js';

// ── Init ──────────────────────────────────────────────────────────────────────

// Populate currency selector
export const currencySelect = document.getElementById('currency-select');

async function initApp() {
  await loadDataAsync();
  
  POPULAR_CURRENCIES.forEach(code => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${symOf(code).trim()} ${code}`;
    if (code === getDisplayCurrency()) opt.selected = true;
    currencySelect.appendChild(opt);
  });
currencySelect.addEventListener('change', () => {
  state.data.displayCurrency = currencySelect.value;
  saveData(state.data);
  renderAll();
  updateRatesStatus();
});

document.getElementById('bom-picker-btn').addEventListener('click', openBomPickerModal);
document.getElementById('new-bom-btn').addEventListener('click', () => openBomModal());
document.getElementById('import-csv-btn').addEventListener('click', triggerCSVImport);
document.getElementById('export-csv-btn').addEventListener('click', () => { const bom = getActiveBom(); if (bom) exportCSV(); else alert('Select a BOM first'); });
document.getElementById('settings-btn').addEventListener('click', openSettingsModal);

// Theme toggle logic
const themeToggleBtn = document.getElementById('theme-toggle-btn');
let currentTheme = localStorage.getItem('bom-theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
document.documentElement.setAttribute('data-theme', currentTheme);

themeToggleBtn.addEventListener('click', () => {
  currentTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('bom-theme', currentTheme);
});
  if (state.data.boms.length > 0) state.activeBomId = state.data.boms[0].id;
  renderAll();
  checkShareParam();
  fetchRates();
}

initApp();
// ── Keyboard shortcuts ─────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === 'Escape') {
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) { overlay.remove(); return; }
  }
  if (document.querySelector('.modal-overlay')) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); if (getActiveBom()) openItemModal(null); }
  if (e.key === '/') { e.preventDefault(); const s = document.getElementById('item-search'); if (s) { s.focus(); s.select(); } }
});
