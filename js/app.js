// ── Currency ──────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS = {
  USD:'$', EUR:'€', GBP:'£', PHP:'₱', SGD:'S$', MYR:'RM ',
  THB:'฿', JPY:'¥', CNY:'¥', AUD:'A$', KRW:'₩', INR:'₹',
  HKD:'HK$', IDR:'Rp ', VND:'₫', NZD:'NZ$', CAD:'C$', CHF:'Fr ',
};

const POPULAR_CURRENCIES = ['USD','PHP','EUR','GBP','SGD','MYR','THB','AUD','JPY','CNY','INR','HKD','IDR','CAD'];

const RATES_CACHE_KEY = 'bom-rates-v1';
const RATES_TTL = 60 * 60 * 1000; // 1 hour

let ratesCache = null; // { rates: { PHP: 56.1, EUR: 0.92, ... }, fetchedAt }

async function fetchRates() {
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

function updateRatesStatus(msg) {
  const el = document.getElementById('rates-status');
  if (!el) return;
  if (msg) { el.textContent = msg; return; }
  if (ratesCache) {
    const age = Math.round((Date.now() - ratesCache.fetchedAt) / 60000);
    el.textContent = `Rates: ${age < 1 ? 'just updated' : age + 'm ago'}`;
  }
}

function getDisplayCurrency() { return data.displayCurrency || 'USD'; }

function symOf(code) { return CURRENCY_SYMBOLS[code] || (code + ' '); }

// Reverse: symbol string → currency code (best guess)
const SYM_TO_CODE = Object.fromEntries(
  Object.entries(CURRENCY_SYMBOLS).map(([code, sym]) => [sym.trim(), code])
);
function codeOfSym(sym) {
  if (!sym) return 'USD';
  const t = sym.trim();
  return SYM_TO_CODE[t] || (() => {
    // Try partial match — e.g. user typed 'S$' or 'RM'
    for (const [code, s] of Object.entries(CURRENCY_SYMBOLS)) {
      if (s.trim() === t) return code;
    }
    return null; // unknown symbol, can't convert
  })();
}

// Convert amount from one currency to display currency.
// Returns { amount, symbol, converted, originalAmount, originalSymbol }
function toDisplay(amount, fromCurrency) {
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

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'bom-tracker-data';

const DEFAULT_SPEC_FIELDS = [
  { id: 'voltage',     name: 'Voltage',       unit: 'V',   type: 'range' },
  { id: 'current',     name: 'Current',       unit: 'A',   type: 'range' },
  { id: 'wattage',     name: 'Wattage',       unit: 'W',   type: 'value' },
  { id: 'capacity',    name: 'Capacity',      unit: 'Ah',  type: 'value' },
  { id: 'weight',      name: 'Weight',        unit: 'g',   type: 'value' },
  { id: 'frequency',   name: 'Frequency',     unit: 'Hz',  type: 'range' },
  { id: 'temperature', name: 'Temp. Range',   unit: '°C',  type: 'range' },
  { id: 'resistance',  name: 'Resistance',    unit: 'Ω',   type: 'range' },
  { id: 'dimensions',  name: 'Dimensions',    unit: 'mm',  type: 'text'  },
  { id: 'connector',   name: 'Connector',     unit: '',    type: 'text'  },
  { id: 'protocol',    name: 'Protocol',      unit: '',    type: 'text'  },
];

function loadData() {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    if (!d.boms) d.boms = [];
    if (!d.specFields) d.specFields = [...DEFAULT_SPEC_FIELDS];
    // Migrate: if item.specs is a plain string, move to specsNotes
    d.boms.forEach(bom => {
      if (!bom.bundles) bom.bundles = [];
      if (!bom.proposals) bom.proposals = [];
      bom.items.forEach(item => {
        if (typeof item.specs === 'string') { item.specsNotes = item.specs; item.specs = {}; }
        if (!item.specs) item.specs = {};
        if (!item.linkedParts) item.linkedParts = [];
      });
    });
    return d;
  } catch { return { boms: [], specFields: [...DEFAULT_SPEC_FIELDS] }; }
}

function saveData(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }

function uuid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// ── State ─────────────────────────────────────────────────────────────────────

let data = loadData();
let activeBomId = null;
let filterState = { fieldId: '', value: '', value2: '' };
let searchQuery = '';

const STATUS_LABEL = { needed: 'Need to order', ordered: 'Ordered', received: 'In stock' };
const STATUS_ORDER = { received: 0, ordered: 1, needed: 2 };

function getActiveBom() { return data.boms.find(b => b.id === activeBomId) || null; }

function getItem(itemId) {
  for (const bom of data.boms) {
    const item = bom.items.find(i => i.id === itemId);
    if (item) return item;
  }
  return null;
}

// ── Spec helpers ──────────────────────────────────────────────────────────────

function hasSpecValue(spec, field) {
  if (!spec) return false;
  if (field.type === 'text')  return !!(spec.text?.trim());
  if (field.type === 'value') return spec.value !== undefined && spec.value !== '';
  if (field.type === 'range') return (spec.min !== '' && spec.min !== undefined) || (spec.max !== '' && spec.max !== undefined) || (spec.value !== '' && spec.value !== undefined);
  return false;
}

function formatSpec(spec, field) {
  if (!spec) return '—';
  if (field.type === 'text') return spec.text || '—';
  if (field.type === 'value') return (spec.value !== '' && spec.value !== undefined) ? `${spec.value}${field.unit}` : '—';
  if (field.type === 'range') {
    const hasMin = spec.min !== undefined && spec.min !== '';
    const hasMax = spec.max !== undefined && spec.max !== '';
    const hasVal = spec.value !== undefined && spec.value !== '';
    if (hasMin && hasMax) return `${spec.min}–${spec.max}${field.unit}`;
    if (hasMin) return `≥${spec.min}${field.unit}`;
    if (hasMax) return `≤${spec.max}${field.unit}`;
    if (hasVal) return `${spec.value}${field.unit}`;
    return '—';
  }
  return '—';
}

// ── Compatibility ─────────────────────────────────────────────────────────────

function checkSpecCompat(specA, specB, field) {
  // Returns: 'ok' | 'warn' | 'mismatch' | 'unknown'
  if (!specA || !specB) return 'unknown';

  if (field.type === 'text') {
    const a = (specA.text || '').toLowerCase().trim();
    const b = (specB.text || '').toLowerCase().trim();
    if (!a || !b) return 'unknown';
    return a === b ? 'ok' : 'mismatch';
  }

  if (field.type === 'value') {
    const a = parseFloat(specA.value), b = parseFloat(specB.value);
    if (isNaN(a) || isNaN(b)) return 'unknown';
    const rel = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 0.001);
    if (rel <= 0.05) return 'ok';
    if (rel <= 0.2)  return 'warn';
    return 'mismatch';
  }

  if (field.type === 'range') {
    // Resolve both to a min/max (a single value means exact, treated as point range)
    const toRange = s => {
      const hasRange = s.min !== undefined && s.min !== '' && s.max !== undefined && s.max !== '';
      if (hasRange) return { lo: parseFloat(s.min), hi: parseFloat(s.max) };
      const v = parseFloat(s.value);
      return isNaN(v) ? null : { lo: v, hi: v };
    };
    const rA = toRange(specA), rB = toRange(specB);
    if (!rA || !rB || isNaN(rA.lo) || isNaN(rB.lo)) return 'unknown';

    const overlapLo = Math.max(rA.lo, rB.lo);
    const overlapHi = Math.min(rA.hi, rB.hi);

    if (overlapHi < overlapLo) return 'mismatch';

    // Warn if overlap is tiny relative to either range
    const sizeA = rA.hi - rA.lo, sizeB = rB.hi - rB.lo;
    const overlapSize = overlapHi - overlapLo;
    if (sizeA > 0 && overlapSize / sizeA < 0.1) return 'warn';
    if (sizeB > 0 && overlapSize / sizeB < 0.1) return 'warn';
    return 'ok';
  }

  return 'unknown';
}

function checkItemCompat(itemA, itemB) {
  return data.specFields
    .map(field => {
      const sA = itemA.specs?.[field.id], sB = itemB.specs?.[field.id];
      if (!hasSpecValue(sA, field) || !hasSpecValue(sB, field)) return null;
      return { field, status: checkSpecCompat(sA, sB, field) };
    })
    .filter(Boolean);
}

function overallStatus(results) {
  if (!results.length) return 'unknown';
  if (results.some(r => r.status === 'mismatch')) return 'mismatch';
  if (results.some(r => r.status === 'warn'))     return 'warn';
  if (results.some(r => r.status === 'ok'))       return 'ok';
  return 'unknown';
}

const COMPAT_ICON  = { ok: '✅', warn: '⚠️', mismatch: '❌', unknown: '🔗' };
const COMPAT_LABEL = { ok: 'Compatible', warn: 'Check values', mismatch: 'Incompatible', unknown: 'Linked' };
const COMPAT_COLOR = { ok: 'var(--green)', warn: '#facc15', mismatch: '#f87171', unknown: 'var(--text-muted)' };

// ── Filter ────────────────────────────────────────────────────────────────────

function itemMatchesFilter(item) {
  if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
  const { fieldId, value, value2 } = filterState;
  if (!fieldId || value === '') return true;
  const field = data.specFields.find(f => f.id === fieldId);
  if (!field) return true;
  const spec = item.specs?.[fieldId];
  if (!hasSpecValue(spec, field)) return false;

  if (field.type === 'text') {
    return (spec.text || '').toLowerCase().includes(value.toLowerCase());
  }

  const num = parseFloat(value);
  if (isNaN(num)) return true;

  if (field.type === 'value') {
    return parseFloat(spec.value) === num;
  }

  if (field.type === 'range') {
    // Filter: "contains value" — does the item's spec include this value?
    const toRange = s => {
      if (s.min !== undefined && s.min !== '' && s.max !== undefined && s.max !== '') return { lo: parseFloat(s.min), hi: parseFloat(s.max) };
      const v = parseFloat(s.value);
      return isNaN(v) ? null : { lo: v, hi: v };
    };
    const r = toRange(spec);
    if (!r) return false;
    if (value2 !== '') {
      const num2 = parseFloat(value2);
      // Filter is itself a range — check overlap
      if (!isNaN(num2)) return Math.max(r.lo, Math.min(num, num2)) <= Math.min(r.hi, Math.max(num, num2));
    }
    return num >= r.lo && num <= r.hi;
  }
  return true;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function renderSidebar() {
  const list = document.getElementById('bom-list');
  if (!data.boms.length) {
    list.innerHTML = `<p style="padding:12px 8px;font-size:0.75rem;color:var(--text-muted)">No BOMs yet.</p>`;
    return;
  }
  list.innerHTML = data.boms.map(bom => {
    const total = calcBomTotal(bom);
    const active = bom.id === activeBomId ? ' active' : '';
    return `<div class="bom-entry${active}" data-id="${bom.id}">
      <div class="bom-entry-name">${esc(bom.name)}</div>
      <div class="bom-entry-meta">${bom.items.length} item${bom.items.length !== 1 ? 's' : ''} · ${total}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('.bom-entry').forEach(el =>
    el.addEventListener('click', () => { activeBomId = el.dataset.id; renderAll(); })
  );
}

// ── BOM header + main ─────────────────────────────────────────────────────────

function renderBomHeader() {
  const bom = getActiveBom();
  const main = document.getElementById('main');
  if (!bom) {
    main.innerHTML = `<div id="no-bom"><div class="icon">📋</div><h2>Select or create a BOM</h2><p>Use the sidebar to get started</p></div>`;
    return;
  }

  const total = calcBomTotal(bom);
  const itemCount = bom.items.reduce((s, i) => s + (i.quantity || 1), 0);
  const field = data.specFields.find(f => f.id === filterState.fieldId);
  const filterIsRange = field?.type === 'range';

  main.innerHTML = `
    <div id="bom-header">
      <div id="bom-title-wrap">
        <div id="bom-name-display">${esc(bom.name)}</div>
        <div id="bom-desc-display">${esc(bom.description || '')}</div>
      </div>
      <div id="bom-stats">
        <div class="stat-chip">${bom.items.length} lines</div>
        <div class="stat-chip">Qty <span>${itemCount}</span></div>
        <div class="stat-chip">Total <span>${total}</span></div>
      </div>
      <button class="header-btn" id="edit-bom-btn">Edit</button>
      <button class="header-btn primary" id="add-item-btn">+ Add Item</button>
      <button class="header-btn" id="manage-bundles-btn">📦 Bundles</button>
      <button class="header-btn" id="compare-btn">⚖ Compare</button>
      <button class="header-btn" id="manage-specs-btn">⚙ Specs</button>
      <button class="header-btn" id="share-bom-btn">🔗 Share</button>
      <button class="header-btn danger" id="delete-bom-btn">Delete</button>
    </div>
    <div id="filter-bar">
      <select id="filter-field">
        <option value="">Filter by spec…</option>
        ${data.specFields.map(f => `<option value="${f.id}" ${f.id === filterState.fieldId ? 'selected' : ''}>${esc(f.name)} (${f.type})</option>`).join('')}
      </select>
      ${field ? `
        ${filterIsRange ? `
          <input type="number" id="filter-val" placeholder="min value" value="${esc(filterState.value)}" style="width:110px">
          <span style="color:var(--text-muted);font-size:0.8rem">–</span>
          <input type="number" id="filter-val2" placeholder="max (opt)" value="${esc(filterState.value2)}" style="width:110px">
          <span style="font-size:0.75rem;color:var(--text-muted)">${esc(field.unit)}</span>
        ` : `
          <input type="${field.type === 'text' ? 'text' : 'number'}" id="filter-val" placeholder="value" value="${esc(filterState.value)}" style="width:140px">
          ${field.unit ? `<span style="font-size:0.75rem;color:var(--text-muted)">${esc(field.unit)}</span>` : ''}
        `}
        <button class="header-btn primary" id="apply-filter-btn">Filter</button>
        <button class="header-btn" id="clear-filter-btn">✕ Clear</button>
      ` : ''}
    </div>
    <div id="items-toolbar">
      <input type="text" id="item-search" placeholder="Search items…" value="${esc(searchQuery)}">
      <select id="sort-select">
        <option value="default" ${!filterState.sort || filterState.sort==='default'?'selected':''}>Order added</option>
        <option value="name" ${filterState.sort==='name'?'selected':''}>Name A–Z</option>
        <option value="price" ${filterState.sort==='price'?'selected':''}>Price: low–high</option>
        <option value="status" ${filterState.sort==='status'?'selected':''}>Status</option>
      </select>
    </div>
    <div id="items-area"></div>`;

  document.getElementById('edit-bom-btn').addEventListener('click', () => openBomModal(bom));
  document.getElementById('add-item-btn').addEventListener('click', () => openItemModal(null));
  document.getElementById('manage-bundles-btn').addEventListener('click', openBundlesModal);
  document.getElementById('compare-btn').addEventListener('click', openCompareModal);
  document.getElementById('manage-specs-btn').addEventListener('click', openSpecFieldsModal);
  document.getElementById('share-bom-btn').addEventListener('click', shareBom);
  document.getElementById('delete-bom-btn').addEventListener('click', deleteBom);

  document.getElementById('item-search').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderItems();
  });

  document.getElementById('sort-select').addEventListener('change', e => {
    filterState.sort = e.target.value;
    renderItems();
  });

  document.getElementById('filter-field').addEventListener('change', e => {
    filterState = { fieldId: e.target.value, value: '', value2: '', sort: filterState.sort };
    renderBomHeader();
  });

  document.getElementById('apply-filter-btn')?.addEventListener('click', () => {
    filterState.value = document.getElementById('filter-val')?.value || '';
    filterState.value2 = document.getElementById('filter-val2')?.value || '';
    renderItems();
  });

  document.getElementById('clear-filter-btn')?.addEventListener('click', () => {
    filterState = { fieldId: filterState.fieldId, value: '', value2: '' };
    document.getElementById('filter-val').value = '';
    if (document.getElementById('filter-val2')) document.getElementById('filter-val2').value = '';
    renderItems();
  });

  renderItems();
}

// ── Items ─────────────────────────────────────────────────────────────────────

function renderItems() {
  const bom = getActiveBom();
  const area = document.getElementById('items-area');
  if (!area || !bom) return;

  let filtered = bom.items.filter(itemMatchesFilter);
  const sort = filterState.sort || 'default';
  if (sort === 'name') filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'price') filtered = [...filtered].sort((a, b) => {
    const cheapest = items => { const p = getPrices(items); return p.length ? p.reduce((x,y) => x.price < y.price ? x : y).price : Infinity; };
    return cheapest(a) - cheapest(b);
  });
  else if (sort === 'status') filtered = [...filtered].sort((a, b) => (STATUS_ORDER[a.status||'needed']||2) - (STATUS_ORDER[b.status||'needed']||2));

  if (!bom.items.length) {
    area.innerHTML = `<div id="empty-state"><div class="icon">🔩</div><h2>No items yet</h2><p>Click "+ Add Item" to start</p></div>`;
    return;
  }

  if (!filtered.length) {
    area.innerHTML = `<div id="empty-state"><div class="icon">🔍</div><h2>No items match filter</h2><p>Try different values</p></div>`;
    return;
  }

  area.innerHTML = filtered.map(item => renderItemCard(item, bom)).join('');

  area.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = bom.items.find(i => i.id === btn.dataset.id);
      if (!item) return;
      const delta = parseInt(btn.dataset.delta);
      item.quantity = Math.max(1, (item.quantity || 1) + delta);
      saveData(data);
      // Update the display without full re-render
      const card = btn.closest('.item-card');
      if (card) {
        card.querySelector('.qty-val').textContent = item.quantity;
        card.querySelector('.item-qty').textContent = `×${item.quantity}`;
      }
      renderSidebar(); // update totals
    });
  });

  area.querySelectorAll('.item-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      const item = bom.items.find(i => i.id === btn.dataset.id);
      if (item) openItemModal(item);
    })
  );

  area.querySelectorAll('.item-copy-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      const item = bom.items.find(i => i.id === btn.dataset.id);
      if (item) openCopyItemModal(item);
    })
  );

  area.querySelectorAll('.item-del-btn').forEach(btn =>
    btn.addEventListener('click', () => deleteItem(btn.dataset.id))
  );
}

function renderItemCard(item, bom) {
  const prices = getPrices(item);
  const cheapest = prices.length ? prices.reduce((a, b) => a.price < b.price ? a : b) : null;

  const imgHtml = item.imageUrl
    ? `<div class="item-img"><img src="${esc(item.imageUrl)}" alt="" onerror="this.parentElement.innerHTML='📦'"></div>`
    : `<div class="item-img">📦</div>`;

  const platformBtns = ['amazon', 'lazada', 'aliexpress'].map(p => {
    const d = item.platforms?.[p];
    if (!d?.url) return '';
    const isCheap = cheapest?.platform === p ? ' cheapest' : '';
    const label = { amazon: '🟠 Amazon', lazada: '🔵 Lazada', aliexpress: '🔴 AliExpress' }[p];
    let priceStr = '';
    if (d.price) {
      const sym = d.currency || '$';
      const fromCode = codeOfSym(sym);
      const conv = fromCode ? toDisplay(parseFloat(d.price), fromCode) : null;
      if (conv && conv.converted) {
        priceStr = ` · ${conv.symbol}${conv.amount.toFixed(2)} <small style="opacity:.6">(${sym}${d.price})</small>`;
      } else {
        priceStr = ` · ${sym}${d.price}`;
      }
    }
    return `<a class="platform-btn ${p}${isCheap}" href="${esc(d.url)}" target="_blank" rel="noopener">${label}${priceStr}</a>`;
  }).join('');

  // Spec chips
  const specChips = data.specFields
    .filter(f => hasSpecValue(item.specs?.[f.id], f))
    .map(f => `<span class="spec-chip">${esc(f.name)}: <strong>${esc(formatSpec(item.specs[f.id], f))}</strong></span>`)
    .join('');

  // Linked parts + compat
  const linkedHtml = (item.linkedParts || []).map(linkedId => {
    const linkedItem = bom.items.find(i => i.id === linkedId);
    if (!linkedItem) return '';
    const results = checkItemCompat(item, linkedItem);
    const status = overallStatus(results);
    const details = results.map(r => `${r.field.name}: ${COMPAT_ICON[r.status]}`).join(' · ') || 'No shared specs';
    return `<div class="compat-chip" style="border-color:${COMPAT_COLOR[status]}22;color:${COMPAT_COLOR[status]}" title="${esc(details)}">
      ${COMPAT_ICON[status]} ${esc(linkedItem.name)} <span style="font-size:0.65rem;opacity:0.7">${esc(details)}</span>
    </div>`;
  }).join('');

  let bestPriceHtml;
  if (cheapest) {
    const sym = cheapest.currency;
    const fromCode = codeOfSym(sym);
    const conv = fromCode ? toDisplay(cheapest.price, fromCode) : null;
    if (conv && conv.converted) {
      bestPriceHtml = `<div class="item-best-price">${conv.symbol}${conv.amount.toFixed(2)}</div><div class="item-best-price-label">best · <span style="opacity:.6">${sym}${cheapest.price}</span></div>`;
    } else {
      bestPriceHtml = `<div class="item-best-price">${sym}${cheapest.price}</div><div class="item-best-price-label">best price</div>`;
    }
  } else {
    bestPriceHtml = `<div class="item-best-price" style="color:var(--text-muted)">—</div>`;
  }

  const status = item.status || 'needed';
  const statusBadge = `<span class="status-badge status-${status}">${STATUS_LABEL[status]}</span>`;
  const bundle = coveredByBundle(item.id, bom);
  const bundleBadge = bundle ? `<span class="bundle-badge" title="Price covered by bundle">📦 ${esc(bundle.name)}</span>` : '';
  const typeBadge = item.componentType ? `<span class="type-badge">${esc(item.componentType)}</span>` : '';

  return `
    <div class="item-card status-${status}">
      ${imgHtml}
      <div class="item-body">
        <div class="item-top">
          <div>
            ${typeBadge}
            <div class="item-name">${esc(item.name)}</div>
          </div>
          <div class="item-top-right">
            ${statusBadge}
            <div class="item-qty">×${item.quantity || 1}</div>
          </div>
        </div>
        ${specChips ? `<div class="spec-chips">${specChips}</div>` : ''}
        ${item.specsNotes ? `<div class="item-specs">${esc(item.specsNotes)}</div>` : ''}
        ${bundleBadge ? `<div style="margin-bottom:6px">${bundleBadge}</div>` : `<div class="item-links">${platformBtns || '<span style="font-size:0.73rem;color:var(--text-muted)">No links added</span>'}</div>`}
        ${linkedHtml ? `<div class="compat-row">${linkedHtml}</div>` : ''}
      </div>
      <div class="item-actions">
        ${bestPriceHtml}
        <div class="qty-control">
          <button class="qty-btn" data-id="${item.id}" data-delta="-1">−</button>
          <span class="qty-val">${item.quantity || 1}</span>
          <button class="qty-btn" data-id="${item.id}" data-delta="1">+</button>
        </div>
        <button class="item-edit-btn" data-id="${item.id}">Edit</button>
        <button class="item-copy-btn" data-id="${item.id}" title="Copy to another BOM">⎘</button>
        <button class="item-del-btn" data-id="${item.id}">Del</button>
      </div>
    </div>`;
}

// ── Copy item to BOM ──────────────────────────────────────────────────────────

function openCopyItemModal(item) {
  const otherBoms = data.boms.filter(b => b.id !== activeBomId);
  const html = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal" style="max-width:400px">
        <div class="modal-header">
          <h2>⎘ Copy Item</h2>
          <button class="modal-close" id="modal-close">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:0.82rem;margin-bottom:14px">Copy <strong>${esc(item.name)}</strong> to:</p>
          ${otherBoms.length ? otherBoms.map(b => `
            <label class="linked-checkbox">
              <input type="radio" name="copy-target" value="${b.id}">
              ${esc(b.name)} <span style="font-size:0.7rem;color:var(--text-muted)">(${b.items.length} items)</span>
            </label>`).join('') : `<p style="font-size:0.78rem;color:var(--text-muted)">No other BOMs. Create one first.</p>`}
        </div>
        <div class="modal-footer">
          <button class="header-btn" id="modal-cancel">Cancel</button>
          ${otherBoms.length ? `<button class="header-btn primary" id="copy-confirm">Copy</button>` : ''}
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-overlay');
  const close = () => overlay.remove();
  document.getElementById('modal-close').addEventListener('click', close);
  document.getElementById('modal-cancel').addEventListener('click', close);

  document.getElementById('copy-confirm')?.addEventListener('click', () => {
    const targetId = document.querySelector('input[name="copy-target"]:checked')?.value;
    if (!targetId) return alert('Select a BOM first');
    const target = data.boms.find(b => b.id === targetId);
    if (!target) return;
    const copy = JSON.parse(JSON.stringify(item));
    copy.id = uuid();
    copy.linkedParts = []; // links don't transfer across BOMs
    target.items.push(copy);
    saveData(data);
    close();
    showToast(`Copied "${item.name}" to "${target.name}"`);
  });
}

// ── BOM modal ─────────────────────────────────────────────────────────────────

function openBomModal(existing = null) {
  const isEdit = !!existing;
  const html = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal">
        <div class="modal-header">
          <h2>${isEdit ? 'Edit BOM' : 'New BOM'}</h2>
          <button class="modal-close" id="modal-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>BOM Name</label>
            <input type="text" id="bom-name-input" placeholder="e.g. Raspberry Pi Robot" value="${esc(existing?.name || '')}">
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea id="bom-desc-input" placeholder="What is this BOM for?">${esc(existing?.description || '')}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="header-btn" id="modal-cancel">Cancel</button>
          <button class="header-btn primary" id="modal-save">${isEdit ? 'Save' : 'Create'}</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-overlay');
  const close = () => overlay.remove();
  document.getElementById('modal-close').addEventListener('click', close);
  document.getElementById('modal-cancel').addEventListener('click', close);
  document.getElementById('bom-name-input').focus();
  document.getElementById('modal-save').addEventListener('click', () => {
    const name = document.getElementById('bom-name-input').value.trim();
    if (!name) return alert('Name required');
    if (isEdit) {
      existing.name = name;
      existing.description = document.getElementById('bom-desc-input').value.trim();
    } else {
      const bom = { id: uuid(), name, description: document.getElementById('bom-desc-input').value.trim(), items: [], createdAt: Date.now() };
      data.boms.push(bom);
      activeBomId = bom.id;
    }
    saveData(data); close(); renderAll();
  });
}

// ── Item modal ────────────────────────────────────────────────────────────────

function openItemModal(existing = null) {
  const isEdit = !!existing;
  const p = existing?.platforms || {};
  const bom = getActiveBom();
  const otherItems = bom.items.filter(i => i.id !== existing?.id);

  const specInputs = data.specFields.map(f => {
    const s = existing?.specs?.[f.id] || {};
    if (f.type === 'range') {
      return `
        <div class="spec-field-row">
          <span class="spec-field-label">${esc(f.name)} <span class="spec-unit">${esc(f.unit)}</span></span>
          <div class="spec-range-inputs">
            <input type="number" class="spec-input" data-field="${f.id}" data-key="min" placeholder="min" value="${s.min ?? ''}">
            <span class="range-dash">–</span>
            <input type="number" class="spec-input" data-field="${f.id}" data-key="max" placeholder="max" value="${s.max ?? ''}">
            <span style="font-size:0.7rem;color:var(--text-muted);white-space:nowrap">or exact:</span>
            <input type="number" class="spec-input" data-field="${f.id}" data-key="value" placeholder="exact" value="${s.value ?? ''}" style="width:70px">
          </div>
        </div>`;
    }
    if (f.type === 'value') {
      return `
        <div class="spec-field-row">
          <span class="spec-field-label">${esc(f.name)} <span class="spec-unit">${esc(f.unit)}</span></span>
          <input type="number" class="spec-input" data-field="${f.id}" data-key="value" placeholder="value" value="${s.value ?? ''}">
        </div>`;
    }
    return `
      <div class="spec-field-row">
        <span class="spec-field-label">${esc(f.name)}</span>
        <input type="text" class="spec-input" data-field="${f.id}" data-key="text" placeholder="e.g. JST-XH" value="${esc(s.text || '')}">
      </div>`;
  }).join('');

  const linkedIds = new Set(existing?.linkedParts || []);
  const linkedCheckboxes = otherItems.length
    ? otherItems.map(i => `
        <label class="linked-checkbox">
          <input type="checkbox" name="linked" value="${i.id}" ${linkedIds.has(i.id) ? 'checked' : ''}>
          ${esc(i.name)}
        </label>`).join('')
    : `<p style="font-size:0.75rem;color:var(--text-muted)">No other items in this BOM yet.</p>`;

  const html = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal" style="max-width:640px">
        <div class="modal-header">
          <h2>${isEdit ? 'Edit Item' : 'Add Item'}</h2>
          <button class="modal-close" id="modal-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="autofill-section">
            <div class="autofill-row">
              <input type="url" id="autofill-url" placeholder="Paste a product URL to auto-fill name, image & price…">
              <button id="autofill-btn" class="autofill-btn">↓ Fill</button>
            </div>
            <div id="autofill-status" class="autofill-status"></div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Item Name</label>
              <input type="text" id="item-name" placeholder="e.g. Raspberry Pi 4B" value="${esc(existing?.name || '')}">
            </div>
            <div class="form-group" style="max-width:90px">
              <label>Qty</label>
              <input type="number" id="item-qty" min="1" value="${existing?.quantity || 1}">
            </div>
            <div class="form-group" style="max-width:140px">
              <label>Component Type</label>
              <input type="text" id="item-type" placeholder="e.g. MCU, Sensor…" value="${esc(existing?.componentType || '')}">
            </div>
            <div class="form-group" style="max-width:130px">
              <label>Status</label>
              <select id="item-status">
                <option value="needed"   ${(existing?.status||'needed')==='needed'   ? 'selected' : ''}>Need to order</option>
                <option value="ordered"  ${existing?.status==='ordered'              ? 'selected' : ''}>Ordered</option>
                <option value="received" ${existing?.status==='received'             ? 'selected' : ''}>In stock</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label>Image URL</label>
            <input type="url" id="item-img" placeholder="https://..." value="${esc(existing?.imageUrl || '')}">
            <img id="img-preview" class="img-preview" src="${esc(existing?.imageUrl || '')}" alt="" style="${existing?.imageUrl ? 'display:block' : 'display:none'}">
          </div>

          <div class="modal-section-title">Specifications</div>
          <div id="spec-fields-list">${specInputs}</div>
          <button class="header-btn" id="add-spec-field-btn" style="margin-top:8px;font-size:0.75rem">+ Define new spec field</button>

          <div class="form-group" style="margin-top:14px">
            <label>Notes</label>
            <textarea id="item-notes" placeholder="Any additional notes...">${esc(existing?.specsNotes || '')}</textarea>
          </div>

          <div class="platform-section">
            <div class="platform-section-title"><span class="platform-dot dot-amazon"></span> Amazon</div>
            <div class="form-row">
              <div class="form-group"><label>Link</label><input type="url" id="amazon-url" placeholder="https://amazon.com/..." value="${esc(p.amazon?.url || '')}"></div>
              <div class="form-group" style="max-width:90px"><label>Price</label><input type="number" id="amazon-price" step="0.01" min="0" value="${p.amazon?.price || ''}"></div>
              <div class="form-group" style="max-width:70px"><label>Currency</label><input type="text" id="amazon-currency" maxlength="5" value="${esc(p.amazon?.currency || '$')}"></div>
            </div>
          </div>
          <div class="platform-section">
            <div class="platform-section-title"><span class="platform-dot dot-lazada"></span> Lazada</div>
            <div class="form-row">
              <div class="form-group"><label>Link</label><input type="url" id="lazada-url" placeholder="https://lazada.com/..." value="${esc(p.lazada?.url || '')}"></div>
              <div class="form-group" style="max-width:90px"><label>Price</label><input type="number" id="lazada-price" step="0.01" min="0" value="${p.lazada?.price || ''}"></div>
              <div class="form-group" style="max-width:70px"><label>Currency</label><input type="text" id="lazada-currency" maxlength="5" value="${esc(p.lazada?.currency || '$')}"></div>
            </div>
          </div>
          <div class="platform-section">
            <div class="platform-section-title"><span class="platform-dot dot-aliexpress"></span> AliExpress</div>
            <div class="form-row">
              <div class="form-group"><label>Link</label><input type="url" id="aliexpress-url" placeholder="https://aliexpress.com/..." value="${esc(p.aliexpress?.url || '')}"></div>
              <div class="form-group" style="max-width:90px"><label>Price</label><input type="number" id="aliexpress-price" step="0.01" min="0" value="${p.aliexpress?.price || ''}"></div>
              <div class="form-group" style="max-width:70px"><label>Currency</label><input type="text" id="aliexpress-currency" maxlength="5" value="${esc(p.aliexpress?.currency || '$')}"></div>
            </div>
          </div>

          <div class="modal-section-title" style="margin-top:16px">Linked / Dependent Parts</div>
          <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:8px">Check parts that connect to this one. Compatibility is calculated from shared spec fields.</p>
          <div id="linked-parts-list">${linkedCheckboxes}</div>
        </div>
        <div class="modal-footer">
          <button class="header-btn" id="modal-cancel">Cancel</button>
          <button class="header-btn primary" id="modal-save">${isEdit ? 'Save' : 'Add'}</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-overlay');
  const close = () => overlay.remove();
  document.getElementById('modal-close').addEventListener('click', close);
  document.getElementById('modal-cancel').addEventListener('click', close);
  document.getElementById('item-name').focus();

  // ── Auto-fill ──
  const autofillInput  = document.getElementById('autofill-url');
  const autofillBtn    = document.getElementById('autofill-btn');
  const autofillStatus = document.getElementById('autofill-status');

  function setAutofillStatus(msg, type = '') {
    autofillStatus.textContent = msg;
    autofillStatus.className = `autofill-status ${type}`;
  }

  async function runAutofill() {
    const url = autofillInput.value.trim();
    if (!url) return;
    autofillBtn.disabled = true;
    autofillBtn.textContent = '…';

    const result = await fetchProductData(url, setAutofillStatus);

    autofillBtn.disabled = false;
    autofillBtn.textContent = '↓ Fill';

    if (!result) return;

    // Fill name if empty
    const nameEl = document.getElementById('item-name');
    if (!nameEl.value.trim()) nameEl.value = result.name;

    // Fill image
    if (result.imageUrl) {
      const imgEl = document.getElementById('item-img');
      imgEl.value = result.imageUrl;
      const preview = document.getElementById('img-preview');
      preview.src = result.imageUrl;
      preview.style.display = 'block';
    }

    // Fill platform URL + price + currency
    const platform = result.platform;
    if (platform && ['amazon','lazada','aliexpress'].includes(platform)) {
      const urlEl      = document.getElementById(`${platform}-url`);
      const priceEl    = document.getElementById(`${platform}-price`);
      const currencyEl = document.getElementById(`${platform}-currency`);
      if (urlEl && !urlEl.value.trim())   urlEl.value      = result.platformUrl;
      if (priceEl && result.price)        priceEl.value    = result.price;
      if (currencyEl && result.currency)  currencyEl.value = result.currency;
    }
  }

  autofillBtn.addEventListener('click', runAutofill);
  autofillInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runAutofill(); } });
  // Auto-trigger on paste
  autofillInput.addEventListener('paste', () => setTimeout(runAutofill, 50));

  // Image preview
  document.getElementById('item-img').addEventListener('input', e => {
    const preview = document.getElementById('img-preview');
    const url = e.target.value.trim();
    preview.src = url; preview.style.display = url ? 'block' : 'none';
  });

  // Add spec field inline
  document.getElementById('add-spec-field-btn').addEventListener('click', () => {
    openDefineSpecFieldModal(() => {
      // Re-open item modal with existing data to show new field
      const tempItem = buildItemFromModal(existing);
      close();
      openItemModal(isEdit ? Object.assign(existing, tempItem) : tempItem);
    });
  });

  document.getElementById('modal-save').addEventListener('click', () => {
    const name = document.getElementById('item-name').value.trim();
    if (!name) return alert('Name required');

    const item = existing || { id: uuid() };
    Object.assign(item, buildItemFromModal(item));
    item.name = name;

    const bom = getActiveBom();
    if (!isEdit) bom.items.push(item);

    // Sync bidirectional links
    bom.items.forEach(other => {
      if (other.id === item.id) return;
      const linked = item.linkedParts.includes(other.id);
      const otherLinked = (other.linkedParts || []).includes(item.id);
      if (linked && !otherLinked) (other.linkedParts = other.linkedParts || []).push(item.id);
      if (!linked && otherLinked) other.linkedParts = other.linkedParts.filter(id => id !== item.id);
    });

    saveData(data); close(); renderAll();
  });
}

function buildItemFromModal(existing) {
  const specs = {};
  document.querySelectorAll('.spec-input').forEach(input => {
    const fid = input.dataset.field, key = input.dataset.key;
    const val = input.value.trim();
    if (!val) return;
    if (!specs[fid]) specs[fid] = {};
    specs[fid][key] = key === 'text' ? val : parseFloat(val);
  });

  const linkedParts = [...document.querySelectorAll('input[name="linked"]:checked')].map(el => el.value);

  return {
    quantity: parseInt(document.getElementById('item-qty')?.value) || 1,
    componentType: document.getElementById('item-type')?.value.trim() || '',
    status: document.getElementById('item-status')?.value || 'needed',
    imageUrl: document.getElementById('item-img')?.value.trim() || '',
    specs,
    specsNotes: document.getElementById('item-notes')?.value.trim() || '',
    linkedParts,
    platforms: {
      amazon: { url: document.getElementById('amazon-url')?.value.trim() || '', price: document.getElementById('amazon-price')?.value || '', currency: document.getElementById('amazon-currency')?.value.trim() || '$' },
      lazada: { url: document.getElementById('lazada-url')?.value.trim() || '', price: document.getElementById('lazada-price')?.value || '', currency: document.getElementById('lazada-currency')?.value.trim() || '$' },
      aliexpress: { url: document.getElementById('aliexpress-url')?.value.trim() || '', price: document.getElementById('aliexpress-price')?.value || '', currency: document.getElementById('aliexpress-currency')?.value.trim() || '$' },
    }
  };
}

// ── Proposals ────────────────────────────────────────────────────────────────

function resolveItemSource(item, bundles, itemOverrides) {
  // Returns { type: 'bundle'|'price'|'excluded'|'none', bundle?, chosen? }
  const bundle = (bundles || []).find(b => b.coversItemIds?.includes(item.id));
  if (bundle) return { type: 'bundle', bundle };
  const override = (itemOverrides || {})[item.id];
  if (override === 'excluded') return { type: 'excluded' };
  const prices = getPrices(item);
  if (!prices.length) return { type: 'none' };
  let chosen = override && override !== 'cheapest'
    ? prices.find(p => p.platform === override)
    : null;
  if (!chosen) chosen = prices.reduce((a, b) => a.price < b.price ? a : b);
  return { type: 'price', chosen };
}

function calcProposalTotal(bom, bundles, itemOverrides) {
  const dc = getDisplayCurrency();
  let total = 0, hasAny = false, hasUnconverted = false;
  const bundleCounted = new Set();

  for (const item of bom.items) {
    const src = resolveItemSource(item, bundles, itemOverrides);
    if (src.type === 'excluded') continue;
    if (src.type === 'bundle') {
      const b = src.bundle;
      if (!bundleCounted.has(b.id) && b.price) {
        bundleCounted.add(b.id);
        hasAny = true;
        const fromCode = codeOfSym(b.currency || '$');
        const conv = fromCode ? toDisplay(parseFloat(b.price), fromCode) : null;
        if (conv) total += conv.amount;
        else { total += parseFloat(b.price); hasUnconverted = true; }
      }
      continue;
    }
    if (src.type === 'none') continue;
    const { chosen } = src;
    hasAny = true;
    const fromCode = codeOfSym(chosen.currency);
    const conv = fromCode ? toDisplay(chosen.price, fromCode) : null;
    if (conv) total += conv.amount * (item.quantity || 1);
    else { total += chosen.price * (item.quantity || 1); hasUnconverted = true; }
  }
  if (!hasAny) return null;
  return { display: (hasUnconverted ? '~' : '') + symOf(dc) + total.toFixed(2), raw: total };
}

function cellForItem(item, bundles, itemOverrides) {
  const src = resolveItemSource(item, bundles, itemOverrides);
  if (src.type === 'bundle') {
    const b = src.bundle;
    const link = b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener" style="color:var(--accent2);text-decoration:none">📦 ${esc(b.name)}</a>` : `📦 ${esc(b.name)}`;
    return { html: `<span class="compare-bundle-cell">${link}</span>`, type: 'bundle' };
  }
  if (src.type === 'excluded') return { html: `<span class="cmp-excluded">Excluded</span>`, type: 'excluded' };
  if (src.type === 'none')     return { html: `<span style="color:var(--text-muted)">—</span>`, type: 'none' };

  const { chosen } = src;
  const sym = chosen.currency;
  const fromCode = codeOfSym(sym);
  const conv = fromCode ? toDisplay(chosen.price, fromCode) : null;
  const qty = item.quantity || 1;
  const unitStr = conv?.converted ? `${conv.symbol}${conv.amount.toFixed(2)}` : `${sym}${chosen.price}`;
  const totalStr = qty > 1
    ? ` <span style="color:var(--text-muted);font-size:0.7rem">×${qty} = ${conv?.converted ? conv.symbol + (conv.amount * qty).toFixed(2) : sym + (parseFloat(chosen.price) * qty).toFixed(2)}</span>`
    : '';
  const label = { amazon: '🟠', lazada: '🔵', aliexpress: '🔴' }[chosen.platform] || '';
  const urlWrap = chosen.url
    ? `<a href="${esc(chosen.url)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${label} ${unitStr}</a>`
    : `${label} ${unitStr}`;
  return { html: urlWrap + totalStr, type: 'price' };
}

function openCompareModal() {
  const bom = getActiveBom();
  if (!bom) return;
  if (!bom.proposals) bom.proposals = [];

  function buildTable() {
    // Columns: "Current BOM" + each proposal
    const cols = [
      { name: 'Current BOM', bundles: bom.bundles || [], itemOverrides: {}, isBase: true },
      ...bom.proposals.map(p => ({ name: p.name, bundles: p.bundles || [], itemOverrides: p.itemOverrides || {}, proposal: p }))
    ];

    const header = `<tr>
      <th class="cmp-type-col">Type</th>
      <th class="cmp-item-col">Item</th>
      <th class="cmp-qty-col">Qty</th>
      ${cols.map((c, i) => `<th class="cmp-proposal-col">
        ${esc(c.name)}
        ${!c.isBase ? `<button class="cmp-edit-btn header-btn" data-idx="${i - 1}" style="margin-left:6px;font-size:0.65rem;padding:2px 7px">Edit</button>` : ''}
      </th>`).join('')}
    </tr>`;

    // Sort items by componentType so same types are grouped
    const sortedItems = [...bom.items].sort((a, b) => (a.componentType || '').localeCompare(b.componentType || ''));

    const rows = sortedItems.map(item => {
      const cells = cols.map(c => cellForItem(item, c.bundles, c.itemOverrides));
      return `<tr>
        <td class="cmp-type-col">${item.componentType ? `<span class="type-badge">${esc(item.componentType)}</span>` : '<span style="color:var(--text-muted);font-size:0.7rem">—</span>'}</td>
        <td class="cmp-item-col"><span style="font-weight:600">${esc(item.name)}</span></td>
        <td class="cmp-qty-col" style="text-align:center;color:var(--text-muted)">${item.quantity || 1}</td>
        ${cells.map(c => `<td class="cmp-data-col">${c.html}</td>`).join('')}
      </tr>`;
    }).join('');

    const totals = cols.map(c => {
      const t = calcProposalTotal(bom, c.bundles);
      return `<td class="cmp-data-col cmp-total-cell">${t ? t.display : '—'}</td>`;
    });

    // Find cheapest proposal total
    const rawTotals = cols.map(c => { const t = calcProposalTotal(bom, c.bundles, c.itemOverrides); return t ? t.raw : Infinity; });
    const minRaw = Math.min(...rawTotals.filter(v => v !== Infinity));
    const totalCells = cols.map((c, i) => {
      const t = calcProposalTotal(bom, c.bundles, c.itemOverrides);
      const isBest = t && t.raw === minRaw && rawTotals.filter(v => v === minRaw).length < cols.length;
      return `<td class="cmp-data-col cmp-total-cell${isBest ? ' cmp-best' : ''}">${t ? t.display : '—'}${isBest ? ' ✓' : ''}</td>`;
    });

    return `
      <div class="cmp-scroll">
        <table class="cmp-table">
          <thead>${header}</thead>
          <tbody>${rows}</tbody>
          <tfoot><tr>
            <td class="cmp-item-col" style="font-weight:700">Total</td>
            <td class="cmp-qty-col"></td>
            ${totalCells.join('')}
          </tr></tfoot>
        </table>
      </div>`;
  }

  function renderProposalList() {
    if (!bom.proposals.length) return `<p style="font-size:0.78rem;color:var(--text-muted)">No proposals yet — the Current BOM is your baseline. Add proposals to compare alternatives.</p>`;
    return bom.proposals.map((p, i) => `
      <div class="bundle-row">
        <div class="bundle-row-info">
          <div class="bundle-row-name">${esc(p.name)}</div>
          <div class="bundle-row-meta">${p.description ? esc(p.description) + ' · ' : ''}${p.bundles?.length || 0} bundle(s)</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="header-btn prop-edit-btn" data-idx="${i}">Edit</button>
          <button class="item-del-btn prop-del-btn" data-idx="${i}">Del</button>
        </div>
      </div>`).join('');
  }

  const html = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal" style="max-width:92vw;width:92vw">
        <div class="modal-header">
          <h2>⚖ Compare Proposals</h2>
          <button class="modal-close" id="modal-close">✕</button>
        </div>
        <div class="modal-body" style="padding-bottom:0">
          <div id="proposals-mgmt" style="margin-bottom:16px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <span style="font-size:0.78rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Proposals</span>
              <button class="header-btn primary" id="add-proposal-btn" style="font-size:0.78rem;padding:5px 12px">+ New Proposal</button>
            </div>
            <div id="proposal-list">${renderProposalList()}</div>
          </div>
          <div id="compare-table-wrap">${buildTable()}</div>
        </div>
        <div class="modal-footer">
          <button class="header-btn primary" id="modal-close2">Done</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-overlay');
  const close = () => { overlay.remove(); renderAll(); };
  document.getElementById('modal-close').addEventListener('click', close);
  document.getElementById('modal-close2').addEventListener('click', close);

  function rebind() {
    document.getElementById('proposal-list').innerHTML = renderProposalList();
    document.getElementById('compare-table-wrap').innerHTML = buildTable();
    document.querySelectorAll('.prop-del-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        bom.proposals.splice(parseInt(btn.dataset.idx), 1);
        saveData(data); rebind();
      })
    );
    document.querySelectorAll('.prop-edit-btn, .cmp-edit-btn').forEach(btn =>
      btn.addEventListener('click', () =>
        openProposalEditModal(bom, parseInt(btn.dataset.idx), rebind)
      )
    );
  }
  rebind();

  document.getElementById('add-proposal-btn').addEventListener('click', () =>
    openProposalEditModal(bom, null, rebind)
  );
}

function openProposalEditModal(bom, idx, onSave) {
  const existing = idx !== null ? bom.proposals[idx] : null;

  const html = `
    <div class="modal-overlay" id="modal-overlay-proposal" style="z-index:200">
      <div class="modal" style="max-width:600px">
        <div class="modal-header">
          <h2>${existing ? 'Edit Proposal' : 'New Proposal'}</h2>
          <button class="modal-close" id="prop-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group">
              <label>Proposal Name</label>
              <input type="text" id="prop-name" placeholder="e.g. Kit approach" value="${esc(existing?.name || '')}">
            </div>
          </div>
          <div class="form-group">
            <label>Description (optional)</label>
            <input type="text" id="prop-desc" placeholder="Short note about this approach" value="${esc(existing?.description || '')}">
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;margin:18px 0 8px">
            <span class="modal-section-title" style="margin:0">Bundles / Kits</span>
            <button class="header-btn primary" id="prop-add-bundle" style="font-size:0.75rem;padding:4px 10px">+ Add Bundle</button>
          </div>
          <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:10px">Items in a bundle use the bundle price. All other items fall back to the source you choose below.</p>
          <div id="prop-bundle-list"></div>

          <div class="modal-section-title" style="margin-top:20px">Individual Item Sources</div>
          <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:10px">Choose which store to use per item, or exclude it from this proposal entirely.</p>
          <div id="prop-item-sources"></div>
        </div>
        <div class="modal-footer">
          <button class="header-btn" id="prop-cancel">Cancel</button>
          <button class="header-btn primary" id="prop-save">${existing ? 'Save' : 'Create Proposal'}</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-overlay-proposal');
  const close = () => overlay.remove();
  document.getElementById('prop-close').addEventListener('click', close);
  document.getElementById('prop-cancel').addEventListener('click', close);
  document.getElementById('prop-name').focus();

  let propBundles = JSON.parse(JSON.stringify(existing?.bundles || []));
  // itemOverrides: map of itemId → 'cheapest'|'amazon'|'lazada'|'aliexpress'|'excluded'
  let propOverrides = JSON.parse(JSON.stringify(existing?.itemOverrides || {}));

  function renderPropBundles() {
    const el = document.getElementById('prop-bundle-list');
    if (!propBundles.length) {
      el.innerHTML = `<p style="font-size:0.78rem;color:var(--text-muted);padding:4px 0">No bundles yet.</p>`;
    } else {
      el.innerHTML = propBundles.map((b, i) => {
        const covered = (b.coversItemIds || []).map(id => bom.items.find(it => it.id === id)?.name).filter(Boolean);
        return `<div class="bundle-row">
          <div class="bundle-row-info">
            <div class="bundle-row-name">${esc(b.name)}</div>
            <div class="bundle-row-meta">${b.currency || '$'}${b.price || '?'} · covers: ${covered.length ? covered.map(esc).join(', ') : 'none'}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="header-btn pb-edit" data-i="${i}">Edit</button>
            <button class="item-del-btn pb-del" data-i="${i}">Del</button>
          </div>
        </div>`;
      }).join('');
      el.querySelectorAll('.pb-del').forEach(btn =>
        btn.addEventListener('click', () => { propBundles.splice(parseInt(btn.dataset.i), 1); renderPropBundles(); renderItemSources(); })
      );
      el.querySelectorAll('.pb-edit').forEach(btn =>
        btn.addEventListener('click', () => openBundleEditModal({ items: bom.items, bundles: propBundles }, parseInt(btn.dataset.i), () => { renderPropBundles(); renderItemSources(); }, true))
      );
    }
    renderItemSources();
  }

  function renderItemSources() {
    const el = document.getElementById('prop-item-sources');
    const coveredIds = new Set(propBundles.flatMap(b => b.coversItemIds || []));
    const rows = bom.items.map(item => {
      const inBundle = coveredIds.has(item.id);
      if (inBundle) {
        const b = propBundles.find(b => b.coversItemIds?.includes(item.id));
        return `<div class="prop-source-row">
          <span class="prop-source-name">${esc(item.name)}</span>
          <span class="prop-source-bundle">📦 ${esc(b?.name || 'bundle')}</span>
        </div>`;
      }
      const prices = getPrices(item);
      const override = propOverrides[item.id] || 'cheapest';
      const opts = [
        { val: 'cheapest',   label: '★ Cheapest' },
        { val: 'amazon',     label: '🟠 Amazon',     disabled: !prices.find(p => p.platform === 'amazon') },
        { val: 'lazada',     label: '🔵 Lazada',     disabled: !prices.find(p => p.platform === 'lazada') },
        { val: 'aliexpress', label: '🔴 AliExpress', disabled: !prices.find(p => p.platform === 'aliexpress') },
        { val: 'excluded',   label: '✕ Exclude' },
      ].filter(o => !o.disabled || o.val === override);
      return `<div class="prop-source-row">
        <span class="prop-source-name">${esc(item.name)}</span>
        <select class="prop-source-select" data-item-id="${item.id}">
          ${opts.map(o => `<option value="${o.val}" ${override === o.val ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>`;
    }).join('');
    el.innerHTML = rows || `<p style="font-size:0.78rem;color:var(--text-muted)">No items in this BOM yet.</p>`;
    el.querySelectorAll('.prop-source-select').forEach(sel =>
      sel.addEventListener('change', () => {
        propOverrides[sel.dataset.itemId] = sel.value;
      })
    );
  }

  renderPropBundles();

  document.getElementById('prop-add-bundle').addEventListener('click', () =>
    openBundleEditModal({ items: bom.items, bundles: propBundles }, null, () => { renderPropBundles(); renderItemSources(); }, true)
  );

  document.getElementById('prop-save').addEventListener('click', () => {
    const name = document.getElementById('prop-name').value.trim();
    if (!name) return alert('Name required');
    // Strip 'cheapest' defaults to keep storage lean
    const cleanOverrides = Object.fromEntries(Object.entries(propOverrides).filter(([, v]) => v !== 'cheapest'));
    const proposal = {
      id: existing?.id || uuid(),
      name,
      description: document.getElementById('prop-desc').value.trim(),
      bundles: propBundles,
      itemOverrides: cleanOverrides,
    };
    if (idx !== null) bom.proposals[idx] = proposal;
    else bom.proposals.push(proposal);
    saveData(data);
    close();
    onSave();
  });
}

// ── URL Auto-fill ─────────────────────────────────────────────────────────────

function detectPlatformFromUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('amazon'))     return 'amazon';
    if (host.includes('lazada'))     return 'lazada';
    if (host.includes('aliexpress')) return 'aliexpress';
  } catch {}
  return null;
}

function detectCurrencySymFromUrl(url) {
  const u = url.toLowerCase();
  if (/amazon\.com\.ph/.test(u) || /lazada\.com\.ph/.test(u)) return '₱';
  if (/amazon\.sg/     .test(u) || /lazada\.sg/     .test(u)) return 'S$';
  if (/amazon\.co\.uk/.test(u))  return '£';
  if (/amazon\.co\.jp/.test(u))  return '¥';
  if (/amazon\.(de|fr|it|es|nl|be|at|pl)/.test(u)) return '€';
  if (/amazon\.com\.au/.test(u)) return 'A$';
  if (/amazon\.ca/    .test(u))  return 'C$';
  if (/lazada\.com\.my/.test(u)) return 'RM ';
  if (/lazada\.co\.th/.test(u))  return '฿';
  if (/lazada\.vn/    .test(u))  return '₫';
  if (/lazada\.co\.id/.test(u))  return 'Rp ';
  return '$';
}

function extractPriceFromHtml(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // JSON-LD structured data (most reliable)
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        let d = JSON.parse(script.textContent);
        if (Array.isArray(d)) d = d[0];
        const offers = d?.offers;
        if (!offers) continue;
        const o = Array.isArray(offers) ? offers[0] : offers;
        if (o?.price !== undefined) {
          const cur = o.priceCurrency ? (symOf(o.priceCurrency) || o.priceCurrency) : null;
          return { price: String(o.price), currency: cur };
        }
      } catch {}
    }
    // Open Graph / product meta tags
    const amount = doc.querySelector('meta[property="product:price:amount"], meta[property="og:price:amount"]')?.content;
    const cur    = doc.querySelector('meta[property="product:price:currency"], meta[property="og:price:currency"]')?.content;
    if (amount) return { price: amount, currency: cur ? (symOf(cur) || cur) : null };
  } catch {}
  return null;
}

async function fetchProductData(url, onStatus) {
  const platform = detectPlatformFromUrl(url);
  const fallbackCurrency = detectCurrencySymFromUrl(url);
  let name = '', imageUrl = '', price = '', currency = fallbackCurrency;

  // ── Step 1: microlink (name + image, occasionally price) ──
  onStatus('Fetching…', 'loading');
  try {
    const res = await fetch(
      `https://api.microlink.io/?url=${encodeURIComponent(url)}&palette=false&audio=false&video=false&iframe=false`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const json = await res.json();
      if (json.status === 'success' && json.data) {
        name     = json.data.title || '';
        imageUrl = json.data.image?.url || '';
        if (json.data.price) {
          price    = String(json.data.price.amount ?? json.data.price ?? '');
          if (json.data.price.currency) currency = symOf(json.data.price.currency) || fallbackCurrency;
        }
      }
    }
  } catch {}

  // ── Step 2: allorigins fallback (price via JSON-LD, and name/image if missing) ──
  if (!price || !name || !imageUrl) {
    if (!price) onStatus('Checking for price…', 'loading');
    try {
      const res = await fetch(
        `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (res.ok) {
        const json = await res.json();
        if (json.contents) {
          if (!price) {
            const extracted = extractPriceFromHtml(json.contents);
            if (extracted?.price) {
              price    = extracted.price;
              currency = extracted.currency || fallbackCurrency;
            }
          }
          if (!name || !imageUrl) {
            const doc = new DOMParser().parseFromString(json.contents, 'text/html');
            if (!name)     name     = doc.querySelector('meta[property="og:title"]')?.content || doc.querySelector('title')?.textContent?.trim() || '';
            if (!imageUrl) imageUrl = doc.querySelector('meta[property="og:image"]')?.content || '';
          }
        }
      }
    } catch {}
  }

  const filled = [name && 'name', imageUrl && 'image', price && 'price'].filter(Boolean);
  if (!filled.length) {
    onStatus('Nothing found — fill manually', 'error');
    return null;
  }
  onStatus(`Got: ${filled.join(', ')}`, 'success');
  return { name, imageUrl, price, currency, platform, platformUrl: url };
}

// ── Bundles / Kits ────────────────────────────────────────────────────────────

function openBundlesModal() {
  const bom = getActiveBom();
  if (!bom) return;
  if (!bom.bundles) bom.bundles = [];

  const PLATFORM_OPTS = ['amazon','lazada','aliexpress','other'];

  function renderBundleList() {
    if (!bom.bundles.length) return `<p style="font-size:0.8rem;color:var(--text-muted);padding:8px 0">No bundles yet. Add one below.</p>`;
    return bom.bundles.map((b, i) => {
      const covered = (b.coversItemIds || []).map(id => bom.items.find(it => it.id === id)?.name).filter(Boolean);
      const priceStr = b.price ? ` · ${b.currency || '$'}${b.price}` : '';
      return `
        <div class="bundle-row" data-idx="${i}">
          <div class="bundle-row-info">
            <div class="bundle-row-name">${esc(b.name)}</div>
            <div class="bundle-row-meta">${esc(b.platform || 'other')}${priceStr} · covers: ${covered.length ? covered.map(esc).join(', ') : 'none'}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="header-btn bundle-edit-btn" data-idx="${i}">Edit</button>
            <button class="item-del-btn bundle-del-btn" data-idx="${i}">Del</button>
          </div>
        </div>`;
    }).join('');
  }

  const html = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal" style="max-width:560px">
        <div class="modal-header">
          <h2>📦 Bundles & Kits</h2>
          <button class="modal-close" id="modal-close">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:14px">A bundle is one purchase link that covers multiple items (e.g. a sensor kit). Covered items are excluded from individual price totals.</p>
          <div id="bundle-list">${renderBundleList()}</div>
          <button class="header-btn primary" id="add-bundle-btn" style="margin-top:12px">+ Add Bundle</button>
        </div>
        <div class="modal-footer">
          <button class="header-btn primary" id="modal-close2">Done</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-overlay');
  const close = () => { overlay.remove(); renderAll(); };
  document.getElementById('modal-close').addEventListener('click', close);
  document.getElementById('modal-close2').addEventListener('click', close);

  function rebind() {
    document.getElementById('bundle-list').innerHTML = renderBundleList();
    document.querySelectorAll('.bundle-del-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        bom.bundles.splice(parseInt(btn.dataset.idx), 1);
        saveData(data);
        rebind();
      })
    );
    document.querySelectorAll('.bundle-edit-btn').forEach(btn =>
      btn.addEventListener('click', () => openBundleEditModal(bom, parseInt(btn.dataset.idx), rebind))
    );
  }
  rebind();

  document.getElementById('add-bundle-btn').addEventListener('click', () =>
    openBundleEditModal(bom, null, rebind)
  );
}

function openBundleEditModal(bom, idx, onSave, skipGlobalSave = false) {
  const existing = idx !== null ? bom.bundles[idx] : null;
  const coveredIds = new Set(existing?.coversItemIds || []);

  const itemCheckboxes = bom.items.map(item => `
    <label class="linked-checkbox">
      <input type="checkbox" name="bundle-item" value="${item.id}" ${coveredIds.has(item.id) ? 'checked' : ''}>
      ${esc(item.name)}
    </label>`).join('') || `<p style="font-size:0.75rem;color:var(--text-muted)">No items in this BOM yet.</p>`;

  const html = `
    <div class="modal-overlay" id="modal-overlay-bundle" style="z-index:200">
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h2>${existing ? 'Edit Bundle' : 'New Bundle'}</h2>
          <button class="modal-close" id="bundle-close">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Bundle Name</label>
            <input type="text" id="bundle-name" placeholder="e.g. Arduino Sensor Kit" value="${esc(existing?.name || '')}">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Platform</label>
              <select id="bundle-platform">
                ${['amazon','lazada','aliexpress','other'].map(p => `<option value="${p}" ${(existing?.platform||'other')===p?'selected':''}>${p.charAt(0).toUpperCase()+p.slice(1)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Price</label>
              <input type="number" id="bundle-price" step="0.01" min="0" placeholder="0.00" value="${existing?.price || ''}">
            </div>
            <div class="form-group" style="max-width:80px">
              <label>Currency</label>
              <input type="text" id="bundle-currency" maxlength="5" value="${esc(existing?.currency || '$')}">
            </div>
          </div>
          <div class="form-group">
            <label>Purchase URL</label>
            <input type="url" id="bundle-url" placeholder="https://..." value="${esc(existing?.url || '')}">
          </div>
          <div class="modal-section-title">Items included in this bundle</div>
          <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:8px">Check every item this purchase covers.</p>
          <div id="bundle-items-list">${itemCheckboxes}</div>
        </div>
        <div class="modal-footer">
          <button class="header-btn" id="bundle-cancel">Cancel</button>
          <button class="header-btn primary" id="bundle-save">${existing ? 'Save' : 'Add Bundle'}</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-overlay-bundle');
  const close = () => overlay.remove();
  document.getElementById('bundle-close').addEventListener('click', close);
  document.getElementById('bundle-cancel').addEventListener('click', close);
  document.getElementById('bundle-name').focus();

  document.getElementById('bundle-save').addEventListener('click', () => {
    const name = document.getElementById('bundle-name').value.trim();
    if (!name) return alert('Name required');
    const coversItemIds = [...document.querySelectorAll('input[name="bundle-item"]:checked')].map(el => el.value);
    const bundle = {
      id: existing?.id || uuid(),
      name,
      platform: document.getElementById('bundle-platform').value,
      price: document.getElementById('bundle-price').value,
      currency: document.getElementById('bundle-currency').value.trim() || '$',
      url: document.getElementById('bundle-url').value.trim(),
      coversItemIds,
    };
    if (idx !== null) bom.bundles[idx] = bundle;
    else bom.bundles.push(bundle);
    if (!skipGlobalSave) saveData(data);
    close();
    onSave();
  });
}

// ── Spec fields manager ───────────────────────────────────────────────────────

function openSpecFieldsModal() {
  const renderList = () => data.specFields.map((f, i) => `
    <div class="spec-mgr-row">
      <span class="spec-mgr-name">${esc(f.name)}</span>
      <span class="spec-mgr-meta">${f.unit || '—'} · ${f.type}</span>
      <button class="item-del-btn spec-del-btn" data-idx="${i}" style="margin-left:auto">Del</button>
    </div>`).join('');

  const html = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h2>⚙ Manage Spec Fields</h2>
          <button class="modal-close" id="modal-close">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:12px">These fields are available on every item across all BOMs.</p>
          <div id="spec-mgr-list">${renderList()}</div>
          <hr style="border-color:var(--border);margin:16px 0">
          <div class="modal-section-title">Add New Field</div>
          <div class="form-row" style="margin-top:8px">
            <div class="form-group"><label>Name</label><input type="text" id="new-field-name" placeholder="e.g. Torque"></div>
            <div class="form-group" style="max-width:80px"><label>Unit</label><input type="text" id="new-field-unit" placeholder="Nm"></div>
            <div class="form-group" style="max-width:110px">
              <label>Type</label>
              <select id="new-field-type">
                <option value="value">value</option>
                <option value="range">range</option>
                <option value="text">text</option>
              </select>
            </div>
          </div>
          <button class="header-btn primary" id="add-field-btn" style="margin-top:4px">+ Add Field</button>
        </div>
        <div class="modal-footer">
          <button class="header-btn primary" id="modal-close2">Done</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-overlay');
  const close = () => { overlay.remove(); renderAll(); };
  document.getElementById('modal-close').addEventListener('click', close);
  document.getElementById('modal-close2').addEventListener('click', close);

  const rebind = () => {
    document.getElementById('spec-mgr-list').innerHTML = renderList();
    document.querySelectorAll('.spec-del-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        data.specFields.splice(parseInt(btn.dataset.idx), 1);
        saveData(data);
        document.getElementById('spec-mgr-list').innerHTML = renderList();
        rebind();
      })
    );
  };
  rebind();

  document.getElementById('add-field-btn').addEventListener('click', () => {
    const name = document.getElementById('new-field-name').value.trim();
    if (!name) return alert('Name required');
    if (data.specFields.find(f => f.name.toLowerCase() === name.toLowerCase())) return alert('Field already exists');
    data.specFields.push({
      id: name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString(36),
      name,
      unit: document.getElementById('new-field-unit').value.trim(),
      type: document.getElementById('new-field-type').value,
    });
    saveData(data);
    document.getElementById('new-field-name').value = '';
    document.getElementById('new-field-unit').value = '';
    document.getElementById('spec-mgr-list').innerHTML = renderList();
    rebind();
  });
}

function openDefineSpecFieldModal(callback) {
  const html = `
    <div class="modal-overlay" id="modal-overlay-inner" style="z-index:200">
      <div class="modal" style="max-width:400px">
        <div class="modal-header"><h2>New Spec Field</h2><button class="modal-close" id="inner-close">✕</button></div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group"><label>Name</label><input type="text" id="inner-field-name" placeholder="e.g. Torque"></div>
            <div class="form-group" style="max-width:80px"><label>Unit</label><input type="text" id="inner-field-unit" placeholder="Nm"></div>
            <div class="form-group" style="max-width:110px"><label>Type</label>
              <select id="inner-field-type"><option value="value">value</option><option value="range">range</option><option value="text">text</option></select>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="header-btn" id="inner-cancel">Cancel</button>
          <button class="header-btn primary" id="inner-save">Add & Continue</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-overlay-inner');
  const close = () => overlay.remove();
  document.getElementById('inner-close').addEventListener('click', close);
  document.getElementById('inner-cancel').addEventListener('click', close);
  document.getElementById('inner-field-name').focus();
  document.getElementById('inner-save').addEventListener('click', () => {
    const name = document.getElementById('inner-field-name').value.trim();
    if (!name) return alert('Name required');
    if (!data.specFields.find(f => f.name.toLowerCase() === name.toLowerCase())) {
      data.specFields.push({
        id: name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString(36),
        name,
        unit: document.getElementById('inner-field-unit').value.trim(),
        type: document.getElementById('inner-field-type').value,
      });
      saveData(data);
    }
    close();
    callback();
  });
}

// ── Delete ────────────────────────────────────────────────────────────────────

function deleteItem(itemId) {
  if (!confirm('Delete this item?')) return;
  const bom = getActiveBom();
  bom.items = bom.items.filter(i => i.id !== itemId);
  // Remove from other items' linkedParts
  bom.items.forEach(i => { i.linkedParts = (i.linkedParts || []).filter(id => id !== itemId); });
  saveData(data); renderAll();
}

function deleteBom() {
  const bom = getActiveBom();
  if (!confirm(`Delete "${bom.name}"?`)) return;
  data.boms = data.boms.filter(b => b.id !== activeBomId);
  activeBomId = data.boms[0]?.id || null;
  saveData(data); renderAll();
}

// ── Import CSV ────────────────────────────────────────────────────────────────

function parseCSVLine(text, pos) {
  const fields = [];
  let i = pos;
  while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
    if (text[i] === '"') {
      i++;
      let val = '';
      while (i < text.length) {
        if (text[i] === '"' && text[i + 1] === '"') { val += '"'; i += 2; }
        else if (text[i] === '"') { i++; break; }
        else val += text[i++];
      }
      fields.push(val);
      if (text[i] === ',') i++;
    } else {
      let val = '';
      while (i < text.length && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') val += text[i++];
      fields.push(val.trim());
      if (text[i] === ',') i++;
    }
  }
  if (text[i] === '\r') i++;
  if (text[i] === '\n') i++;
  return { fields, next: i };
}

function parseCSV(text) {
  const rows = [];
  let pos = 0;
  while (pos < text.length) {
    const { fields, next } = parseCSVLine(text, pos);
    pos = next;
    if (fields.length && !(fields.length === 1 && fields[0] === '')) rows.push(fields);
  }
  return rows;
}

function importItemsFromCSV(rows) {
  // Find ITEMS section header row
  let headerIdx = rows.findIndex(r => r[0] === 'ITEMS');
  headerIdx = headerIdx >= 0 ? headerIdx + 1 : (rows[0]?.[0] === 'Name' ? 0 : -1);
  if (headerIdx < 0) return null;

  const header = rows[headerIdx];
  const ci = name => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const iName    = ci('name');
  const iQty     = ci('qty');
  const iStatus  = ci('status');
  const iType    = ci('component type') >= 0 ? ci('component type') : ci('componenttype');
  const iNotes   = ci('notes');
  const iImg     = ci('image url');
  const iAmazonUrl = ci('amazon url'), iAmazonPrice = ci('amazon price'), iAmazonCur = ci('amazon currency');
  const iLazUrl    = ci('lazada url'),  iLazPrice    = ci('lazada price'),  iLazCur    = ci('lazada currency');
  const iAliUrl    = ci('aliexpress url'), iAliPrice = ci('aliexpress price'), iAliCur = ci('aliexpress currency');
  if (iName < 0) return null;

  // Detect spec field columns: headers matching existing spec field names
  const specColMap = []; // { fieldId, colIdx }
  data.specFields.forEach(f => {
    const idx = header.findIndex(h => h.toLowerCase().startsWith(f.name.toLowerCase()));
    if (idx >= 0) specColMap.push({ field: f, colIdx: idx });
  });

  // Find end of items section
  let endIdx = rows.length;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const first = rows[i][0];
    if (first === 'BUNDLES' || first === 'BUNDLES (Current BOM)' || first === 'PROPOSALS' || first === '') {
      endIdx = i; break;
    }
  }

  const items = [];
  for (let i = headerIdx + 1; i < endIdx; i++) {
    const r = rows[i];
    const name = r[iName]?.trim();
    if (!name) continue;

    // Parse specs
    const specs = {};
    specColMap.forEach(({ field, colIdx }) => {
      const raw = r[colIdx]?.trim();
      if (!raw || raw === '—') return;
      if (field.type === 'text') {
        specs[field.id] = { text: raw };
      } else if (field.type === 'value') {
        const v = parseFloat(raw);
        if (!isNaN(v)) specs[field.id] = { value: v };
      } else if (field.type === 'range') {
        // "5–12V" or "5V" or "5"
        const rangeMatch = raw.replace(/[^\d.\-–]/g, '').match(/^([\d.]+)[–-]([\d.]+)$/);
        if (rangeMatch) specs[field.id] = { min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]) };
        else { const v = parseFloat(raw); if (!isNaN(v)) specs[field.id] = { value: v }; }
      }
    });

    const statusRaw = (r[iStatus] || '').toLowerCase();
    const status = statusRaw.includes('order') && !statusRaw.includes('need') ? 'ordered'
                 : statusRaw.includes('stock') || statusRaw.includes('receiv') ? 'received'
                 : 'needed';

    items.push({
      id: uuid(),
      name,
      componentType: iType >= 0 ? r[iType]?.trim() || '' : '',
      quantity: parseInt(r[iQty]) || 1,
      status,
      specsNotes: iNotes >= 0 ? r[iNotes]?.trim() || '' : '',
      imageUrl:   iImg   >= 0 ? r[iImg]?.trim()   || '' : '',
      specs,
      linkedParts: [],
      platforms: {
        amazon:     { url: r[iAmazonUrl]?.trim() || '', price: r[iAmazonPrice]?.trim() || '', currency: r[iAmazonCur]?.trim() || '$' },
        lazada:     { url: r[iLazUrl]?.trim()    || '', price: r[iLazPrice]?.trim()    || '', currency: r[iLazCur]?.trim()    || '$' },
        aliexpress: { url: r[iAliUrl]?.trim()    || '', price: r[iAliPrice]?.trim()    || '', currency: r[iAliCur]?.trim()    || '$' },
      },
    });
  }
  return items;
}

function triggerCSVImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const rows = parseCSV(e.target.result);
      const items = importItemsFromCSV(rows);
      if (!items || !items.length) {
        alert('No items found in CSV. Make sure it was exported from BOM Tracker.');
        return;
      }
      openCSVImportModal(items, file.name);
    };
    reader.readAsText(file);
  });
  input.click();
}

function openCSVImportModal(items, filename) {
  const bom = getActiveBom();
  const html = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal" style="max-width:460px">
        <div class="modal-header">
          <h2>↑ Import CSV</h2>
          <button class="modal-close" id="modal-close">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:0.82rem;margin-bottom:14px">
            Found <strong>${items.length} item(s)</strong> in <em>${esc(filename)}</em>.
          </p>
          <div class="form-group">
            <label>Import into</label>
            <select id="import-target">
              ${bom ? `<option value="${bom.id}">Current BOM: ${esc(bom.name)}</option>` : ''}
              ${data.boms.filter(b => b.id !== bom?.id).map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}
              <option value="__new__">+ Create new BOM from file</option>
            </select>
          </div>
          <div class="form-group" id="new-bom-name-group" style="display:none">
            <label>New BOM Name</label>
            <input type="text" id="import-bom-name" placeholder="BOM name" value="${esc(filename.replace(/\.csv$/i, ''))}">
          </div>
          <div class="form-group">
            <label>If item name already exists</label>
            <select id="import-dupe">
              <option value="add">Add anyway (allow duplicates)</option>
              <option value="skip">Skip duplicates</option>
            </select>
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:10px;max-height:140px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px">
            ${items.slice(0, 20).map(it => `<div style="padding:2px 0">${esc(it.componentType ? it.componentType + ' · ' : '')}${esc(it.name)} <span style="color:var(--text-muted)">×${it.quantity}</span></div>`).join('')}
            ${items.length > 20 ? `<div style="color:var(--text-muted);margin-top:4px">…and ${items.length - 20} more</div>` : ''}
          </div>
        </div>
        <div class="modal-footer">
          <button class="header-btn" id="modal-cancel">Cancel</button>
          <button class="header-btn primary" id="import-confirm">Import ${items.length} item(s)</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-overlay');
  const close = () => overlay.remove();
  document.getElementById('modal-close').addEventListener('click', close);
  document.getElementById('modal-cancel').addEventListener('click', close);

  document.getElementById('import-target').addEventListener('change', e => {
    document.getElementById('new-bom-name-group').style.display = e.target.value === '__new__' ? '' : 'none';
  });

  document.getElementById('import-confirm').addEventListener('click', () => {
    const targetVal = document.getElementById('import-target').value;
    const skipDupes = document.getElementById('import-dupe').value === 'skip';

    let targetBom;
    if (targetVal === '__new__') {
      const name = document.getElementById('import-bom-name').value.trim() || filename;
      targetBom = { id: uuid(), name, description: '', items: [], bundles: [], proposals: [], createdAt: Date.now() };
      data.boms.push(targetBom);
      activeBomId = targetBom.id;
    } else {
      targetBom = data.boms.find(b => b.id === targetVal);
    }
    if (!targetBom) return;

    let added = 0, skipped = 0;
    for (const item of items) {
      if (skipDupes && targetBom.items.some(i => i.name.toLowerCase() === item.name.toLowerCase())) {
        skipped++;
        continue;
      }
      targetBom.items.push(item);
      added++;
    }

    saveData(data);
    close();
    renderAll();
    showToast(`Imported ${added} item(s)${skipped ? `, skipped ${skipped} duplicate(s)` : ''}`);
  });
}

// ── Export CSV ────────────────────────────────────────────────────────────────

function exportCSV() {
  const bom = getActiveBom();
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const row = cols => cols.map(q).join(',');
  const blank = () => '';
  const sections = [];

  // ── Items ──
  const specHeaders = data.specFields.map(f => `${f.name} (${f.unit || f.type})`);
  sections.push(row(['ITEMS']));
  sections.push(row(['Name', 'Qty', 'Status', 'Covered By Bundle', 'Notes', 'Image URL',
    ...specHeaders,
    'Amazon URL', 'Amazon Price', 'Amazon Currency',
    'Lazada URL', 'Lazada Price', 'Lazada Currency',
    'AliExpress URL', 'AliExpress Price', 'AliExpress Currency',
    'Best Price', 'Linked Parts']));

  for (const item of bom.items) {
    const prices = getPrices(item);
    const cheapest = prices.length ? prices.reduce((a, b) => a.price < b.price ? a : b) : null;
    const p = item.platforms || {};
    const specValues = data.specFields.map(f => formatSpec(item.specs?.[f.id], f));
    const linkedNames = (item.linkedParts || []).map(id => bom.items.find(i => i.id === id)?.name || '').filter(Boolean).join('; ');
    const bundle = coveredByBundle(item.id, bom);
    sections.push(row([
      item.name, item.quantity || 1,
      STATUS_LABEL[item.status || 'needed'] || item.status || '',
      bundle ? bundle.name : '',
      item.specsNotes || '', item.imageUrl || '',
      ...specValues,
      p.amazon?.url || '', p.amazon?.price || '', p.amazon?.currency || '',
      p.lazada?.url || '', p.lazada?.price || '', p.lazada?.currency || '',
      p.aliexpress?.url || '', p.aliexpress?.price || '', p.aliexpress?.currency || '',
      cheapest ? `${cheapest.currency}${cheapest.price}` : '',
      linkedNames,
    ]));
  }

  const baseName = bom.name.replace(/[^a-z0-9]/gi, '_');

  // Download items CSV
  const itemsCsv = sections.join('\n');
  downloadText(itemsCsv, `${baseName}_items.csv`, 'text/csv');

  // ── Bundles + Proposals — separate file if any exist ──
  const allBundles = [
    ...(bom.bundles || []).map(b => ({ ...b, _source: 'Current BOM' })),
    ...(bom.proposals || []).flatMap(p => (p.bundles || []).map(b => ({ ...b, _source: `Proposal: ${p.name}` }))),
  ];

  if (allBundles.length || bom.proposals?.length) {
    const bSections = [];
    bSections.push(row(['BUNDLES & PROPOSALS', bom.name]));
    bSections.push('');

    if (allBundles.length) {
      bSections.push(row(['Source', 'Bundle Name', 'Platform', 'Price', 'Currency', 'URL', 'Covers Items']));
      for (const b of allBundles) {
        const covered = (b.coversItemIds || []).map(id => bom.items.find(i => i.id === id)?.name || '').filter(Boolean).join('; ');
        bSections.push(row([b._source, b.name, b.platform || '', b.price || '', b.currency || '$', b.url || '', covered]));
      }
      bSections.push('');
    }

    if (bom.proposals?.length) {
      bSections.push(row(['PROPOSAL TOTALS']));
      bSections.push(row(['Proposal', 'Description', 'Bundles', 'Total']));
      for (const prop of bom.proposals) {
        const t = calcProposalTotal(bom, prop.bundles || [], prop.itemOverrides || {});
        bSections.push(row([prop.name, prop.description || '', prop.bundles?.length || 0, t ? t.display : 'No prices']));
      }
    }

    setTimeout(() => downloadText(bSections.join('\n'), `${baseName}_bundles_proposals.csv`, 'text/csv'), 300);
  }
}

function downloadText(text, filename, type) {
  const a = document.createElement('a');
  a.href = `data:${type};charset=utf-8,` + encodeURIComponent(text);
  a.download = filename;
  a.click();
}

// ── Calc ──────────────────────────────────────────────────────────────────────

function getPrices(item) {
  return ['amazon', 'lazada', 'aliexpress']
    .map(p => { const d = item.platforms?.[p]; return d?.price && d?.url ? { platform: p, price: parseFloat(d.price), currency: d.currency || '$' } : null; })
    .filter(Boolean);
}

function coveredByBundle(itemId, bom) {
  return (bom.bundles || []).find(b => b.coversItemIds?.includes(itemId)) || null;
}

function calcBomTotal(bom) {
  const dc = getDisplayCurrency();
  let total = 0, hasAny = false, hasUnconverted = false;
  const bundleCounted = new Set();

  for (const item of bom.items) {
    const bundle = coveredByBundle(item.id, bom);
    if (bundle) {
      if (!bundleCounted.has(bundle.id) && bundle.price) {
        bundleCounted.add(bundle.id);
        hasAny = true;
        const fromCode = codeOfSym(bundle.currency || '$');
        const conv = fromCode ? toDisplay(parseFloat(bundle.price), fromCode) : null;
        if (conv) total += conv.amount;
        else { total += parseFloat(bundle.price); hasUnconverted = true; }
      }
      continue;
    }
    const prices = getPrices(item);
    if (!prices.length) continue;
    const cheapest = prices.reduce((a, b) => a.price < b.price ? a : b);
    hasAny = true;
    const fromCode = codeOfSym(cheapest.currency);
    const conv = fromCode ? toDisplay(cheapest.price, fromCode) : null;
    if (conv) {
      total += conv.amount * (item.quantity || 1);
    } else {
      total += cheapest.price * (item.quantity || 1);
      hasUnconverted = true;
    }
  }
  if (!hasAny) return 'No prices';
  return (hasUnconverted ? '~' : '') + symOf(dc) + total.toFixed(2);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Share / Import ────────────────────────────────────────────────────────────

function shareBom() {
  const bom = getActiveBom();
  if (!bom) return;
  try {
    const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(bom));
    const url = `${location.origin}${location.pathname}#share=${compressed}`;
    navigator.clipboard.writeText(url).then(() => {
      showToast('Share link copied to clipboard!');
    }).catch(() => {
      // Fallback: show in a prompt so they can copy manually
      prompt('Copy this link:', url);
    });
  } catch (e) {
    alert('Failed to generate share link.');
  }
}

function checkShareParam() {
  const hash = location.hash;
  if (!hash.startsWith('#share=')) return;
  const compressed = hash.slice(7);
  try {
    const bom = JSON.parse(LZString.decompressFromEncodedURIComponent(compressed));
    if (!bom?.name) return;

    // Check if already imported
    const exists = data.boms.find(b => b.name === bom.name);
    const suffix = exists ? ` (already have "${bom.name}" — will import as copy)` : '';

    const bundleCount = (bom.bundles || []).length;
    const propCount = (bom.proposals || []).length;
    const details = [
      `${bom.items.length} item(s)`,
      bundleCount ? `${bundleCount} bundle(s)` : '',
      propCount ? `${propCount} proposal(s)` : '',
    ].filter(Boolean).join(', ');
    if (!confirm(`Import shared BOM: "${bom.name}"?${suffix}\n\n${details}`)) {
      history.replaceState(null, '', location.pathname);
      return;
    }

    // Re-assign IDs to avoid collisions
    const idMap = {};
    bom.id = uuid();
    bom.items.forEach(item => {
      const oldId = item.id;
      item.id = uuid();
      idMap[oldId] = item.id;
    });

    // Re-wire item references using new IDs
    const remapIds = ids => (ids || []).map(old => idMap[old]).filter(Boolean);
    bom.items.forEach(item => { item.linkedParts = remapIds(item.linkedParts); });

    const remapBundle = b => { b.id = uuid(); b.coversItemIds = remapIds(b.coversItemIds); };
    (bom.bundles || []).forEach(remapBundle);
    (bom.proposals || []).forEach(p => { p.id = uuid(); (p.bundles || []).forEach(remapBundle); });

    if (!bom.bundles) bom.bundles = [];
    if (!bom.proposals) bom.proposals = [];

    data.boms.push(bom);
    activeBomId = bom.id;
    saveData(data);
    history.replaceState(null, '', location.pathname);
    renderAll();
    showToast(`Imported "${bom.name}"`);
  } catch (e) {
    console.error('Failed to import shared BOM', e);
    history.replaceState(null, '', location.pathname);
  }
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('toast-show'), 10);
  setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.remove(), 300); }, 3000);
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderAll() { renderSidebar(); renderBomHeader(); }

// ── Init ──────────────────────────────────────────────────────────────────────

// Populate currency selector
const currencySelect = document.getElementById('currency-select');
POPULAR_CURRENCIES.forEach(code => {
  const opt = document.createElement('option');
  opt.value = code;
  opt.textContent = `${symOf(code).trim()} ${code}`;
  if (code === getDisplayCurrency()) opt.selected = true;
  currencySelect.appendChild(opt);
});
currencySelect.addEventListener('change', () => {
  data.displayCurrency = currencySelect.value;
  saveData(data);
  renderAll();
  updateRatesStatus();
});

document.getElementById('new-bom-btn').addEventListener('click', () => openBomModal());
document.getElementById('import-csv-btn').addEventListener('click', triggerCSVImport);
document.getElementById('export-csv-btn').addEventListener('click', () => { const bom = getActiveBom(); if (bom) exportCSV(); else alert('Select a BOM first'); });
document.getElementById('hide-sidebar-btn').addEventListener('click', () => document.body.classList.add('sidebar-hidden'));
document.getElementById('show-sidebar-btn').addEventListener('click', () => document.body.classList.remove('sidebar-hidden'));
if (data.boms.length > 0) activeBomId = data.boms[0].id;
renderAll();
checkShareParam();
fetchRates();
