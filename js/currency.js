import { getItem, state } from './data.js';
import { renderAll } from './ui/render.js';

// ── Currency ──────────────────────────────────────────────────────────────────

export const CURRENCY_SYMBOLS = {
  USD:'$', EUR:'€', GBP:'£', PHP:'₱', SGD:'S$', MYR:'RM ',
  THB:'฿', JPY:'¥', CNY:'¥', AUD:'A$', KRW:'₩', INR:'₹',
  HKD:'HK$', IDR:'Rp ', VND:'₫', NZD:'NZ$', CAD:'C$', CHF:'Fr ',
};

export const POPULAR_CURRENCIES = ['USD','PHP','EUR','GBP','SGD','MYR','THB','AUD','JPY','CNY','INR','HKD','IDR','CAD'];

export const RATES_CACHE_KEY = 'bom-rates-v1';
export const RATES_TTL = 60 * 60 * 1000; // 1 hour

export let ratesCache = null; // { rates: { PHP: 56.1, EUR: 0.92, ... }, fetchedAt }

export async function fetchRates() {
  try {
    const cached = JSON.parse(localStorage.getItem(RATES_CACHE_KEY));
    if (cached && Date.now() - cached.fetchedAt < RATES_TTL) {
      ratesCache = cached; updateRatesStatus(); return;
    }
  } catch {}
  updateRatesStatus('Fetching rates…');

  async function tryFrankfurter() {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD');
    if (!res.ok) throw new Error(`frankfurter ${res.status}`);
    const json = await res.json();
    return { ...json.rates, USD: 1 };
  }

  async function tryFawazahmed() {
    const res = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json');
    if (!res.ok) throw new Error(`fawazahmed ${res.status}`);
    const json = await res.json();
    // rates are under json.usd, all lowercase keys
    const raw = json.usd;
    const rates = { USD: 1 };
    for (const [k, v] of Object.entries(raw)) rates[k.toUpperCase()] = v;
    return rates;
  }

  try {
    let rates;
    try { rates = await tryFrankfurter(); }
    catch (e1) {
      console.warn('Frankfurter failed:', e1.message, '— trying fallback…');
      rates = await tryFawazahmed();
    }
    ratesCache = { rates, fetchedAt: Date.now() };
    localStorage.setItem(RATES_CACHE_KEY, JSON.stringify(ratesCache));
    updateRatesStatus();
    renderAll();
  } catch (e) {
    console.error('All rate sources failed:', e);
    try {
      const cached = JSON.parse(localStorage.getItem(RATES_CACHE_KEY));
      if (cached) { ratesCache = cached; updateRatesStatus('(offline — cached)'); renderAll(); return; }
    } catch {}
    updateRatesStatus('Rates unavailable');
  }
}

export function updateRatesStatus(msg) {
  const el = document.getElementById('rates-status');
  if (!el) return;
  if (msg) { el.textContent = msg; return; }
  if (ratesCache) {
    const age = Math.round((Date.now() - ratesCache.fetchedAt) / 60000);
    el.textContent = `Rates: ${age < 1 ? 'just updated' : age + 'm ago'}`;
  }
}

export function getDisplayCurrency() { return state.data.displayCurrency || 'USD'; }

export function symOf(code) { return CURRENCY_SYMBOLS[code] || (code + ' '); }

// Reverse: symbol string → currency code (best guess)
export const SYM_TO_CODE = Object.fromEntries(
  Object.entries(CURRENCY_SYMBOLS).map(([code, sym]) => [sym.trim(), code])
);
export function codeOfSym(sym) {
  if (!sym) return 'USD';
  const t = sym.trim();
  if (SYM_TO_CODE[t]) return SYM_TO_CODE[t];             // symbol → code
  if (CURRENCY_SYMBOLS[t.toUpperCase()]) return t.toUpperCase(); // already a code
  for (const [code, s] of Object.entries(CURRENCY_SYMBOLS)) {
    if (s.trim() === t) return code;
  }
  return null;
}

// Convert and format a price into the display currency.
// Returns a plain string like "$12.50" or "₱999.00 → $17.80"
export function priceInDisplay(amount, currencySym, showOriginal = false) {
  const amt = parseFloat(amount);
  if (isNaN(amt)) return '';
  const fromCode = codeOfSym(currencySym);
  if (!fromCode) return `${currencySym}${amt.toFixed(2)}`;
  const conv = toDisplay(amt, fromCode);
  const main = `${conv.symbol}${conv.amount.toFixed(2)}`;
  if (showOriginal && conv.converted) {
    return `${main} <small style="opacity:.5">${currencySym}${amt.toFixed(2)}</small>`;
  }
  return main;
}

// Convert amount from one currency to display currency.
// Returns { amount, symbol, converted, originalAmount, originalSymbol }
export function toDisplay(amount, fromCurrency) {
  const to = getDisplayCurrency();
  const from = (fromCurrency || 'USD').toUpperCase();
  if (from === to || !ratesCache) {
    return { amount, symbol: symOf(to), converted: false };
  }
  const rF = ratesCache.rates[from], rT = ratesCache.rates[to];
  if (!rF || !rT) return { amount, symbol: symOf(to), converted: false };
  return {
    amount: amount / rF * rT,
    symbol: symOf(to),
    converted: true,
    originalAmount: amount,
    originalSymbol: symOf(from),
  };
}
