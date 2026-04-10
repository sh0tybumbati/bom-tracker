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
  if (SYM_TO_CODE[t]) return SYM_TO_CODE[t];             // symbol → code
  if (CURRENCY_SYMBOLS[t.toUpperCase()]) return t.toUpperCase(); // already a code
  for (const [code, s] of Object.entries(CURRENCY_SYMBOLS)) {
    if (s.trim() === t) return code;
  }
  return null;
}

// Convert and format a price into the display currency.
// Returns a plain string like "$12.50" or "₱999.00 → $17.80"
function priceInDisplay(amount, currencySym, showOriginal = false) {
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
      bom.bundles.forEach(b => { if (!b.id) b.id = uuid(); });
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
let viewMode = localStorage.getItem('bom-view-mode') || 'list';

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

function updateTopbarBomName() {
  const bom = getActiveBom();
  const el = document.getElementById('topbar-bom-name');
  if (el) el.textContent = bom ? bom.name : 'Select BOM';
}

function openBomPickerModal() {
  const html = `
    <div class="modal-overlay" id="bom-picker-overlay">
      <div class="modal" style="max-width:340px">
        <div class="modal-header">
          <h2>📋 BOMs</h2>
          <button class="modal-close" id="bom-picker-close">✕</button>
        </div>
        <div class="modal-body" style="padding:8px">
          ${data.boms.length ? data.boms.map(b => `
            <div class="bom-entry${b.id === activeBomId ? ' active' : ''}" data-id="${b.id}">
              <div class="bom-entry-name">${esc(b.name)}</div>
              <div class="bom-entry-meta">${b.items.length} item${b.items.length !== 1 ? 's' : ''} · ${calcBomTotal(b)}</div>
            </div>`).join('') : `<p style="padding:12px;font-size:0.78rem;color:var(--text-muted)">No BOMs yet.</p>`}
        </div>
        <div class="modal-footer">
          <button class="header-btn primary" id="bom-picker-new">+ New BOM</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('bom-picker-overlay');
  const close = () => overlay.remove();
  document.getElementById('bom-picker-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('.bom-entry').forEach(el =>
    el.addEventListener('click', () => { activeBomId = el.dataset.id; close(); renderAll(); })
  );
  document.getElementById('bom-picker-new').addEventListener('click', () => { close(); openBomModal(null); });
}

// ── BOM header + main ─────────────────────────────────────────────────────────

function renderBomHeader() {
  const bom = getActiveBom();
  const main = document.getElementById('main');
  if (!bom) {
    main.innerHTML = `
      <div id="no-bom">
        <div class="no-bom-icon">📋</div>
        <h2>${data.boms.length ? 'Select a BOM' : 'Welcome to BOM Tracker'}</h2>
        <p>${data.boms.length
          ? 'Tap the BOM picker at the top to switch between your bills of materials.'
          : 'Track components, compare prices across suppliers, and manage procurement for your projects.'}</p>
        <button class="header-btn primary" id="no-bom-create-btn">
          ${data.boms.length ? '📋 Open BOM picker' : '+ Create your first BOM'}
        </button>
      </div>`;
    document.getElementById('no-bom-create-btn').addEventListener('click',
      () => data.boms.length ? openBomPickerModal() : openBomModal(null)
    );
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
      <button class="header-btn" id="edit-bom-btn" title="Edit BOM">✏ <span class="btn-text">Edit</span></button>
      <button class="header-btn primary" id="add-item-btn" title="Add Item">+ <span class="btn-text">Add Item</span></button>
      <button class="header-btn" id="manage-bundles-btn" title="Manage Bundles">📦 <span class="btn-text">Bundles</span></button>
      <button class="header-btn" id="compare-btn" title="Compare Proposals">⚖ <span class="btn-text">Compare</span></button>
      <button class="header-btn" id="manage-specs-btn" title="Manage Spec Fields">⚙ <span class="btn-text">Specs</span></button>
      <button class="header-btn" id="share-bom-btn" title="Share BOM">🔗 <span class="btn-text">Share</span></button>
      <button class="header-btn danger" id="delete-bom-btn" title="Delete BOM">🗑 <span class="btn-text">Delete</span></button>
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
      <button id="view-toggle-btn" class="${viewMode === 'tile' ? 'active' : ''}" title="${viewMode === 'tile' ? 'List view' : 'Tile view'}">${viewMode === 'tile' ? '≡ List' : '⊞ Tiles'}</button>
      <span id="toolbar-total">${total}</span>
    </div>
    <div id="items-area"></div>`;

  document.getElementById('edit-bom-btn').addEventListener('click', () => openBomModal(bom));
  document.getElementById('add-item-btn').addEventListener('click', () => openItemModal(null));
  document.getElementById('manage-bundles-btn').addEventListener('click', openBundlesModal);
  document.getElementById('compare-btn').addEventListener('click', openCompareBomModal);
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

  document.getElementById('view-toggle-btn').addEventListener('click', () => {
    viewMode = viewMode === 'tile' ? 'list' : 'tile';
    localStorage.setItem('bom-view-mode', viewMode);
    const btn = document.getElementById('view-toggle-btn');
    btn.textContent = viewMode === 'tile' ? '≡ List' : '⊞ Tiles';
    btn.title = viewMode === 'tile' ? 'List view' : 'Tile view';
    btn.classList.toggle('active', viewMode === 'tile');
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

  area.classList.toggle('tile-view', viewMode === 'tile');
  area.innerHTML = viewMode === 'tile'
    ? filtered.map(item => renderItemTile(item, bom)).join('')
    : filtered.map(item => renderItemCard(item, bom)).join('');

  area.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = bom.items.find(i => i.id === btn.dataset.id);
      if (!item) return;
      const delta = parseInt(btn.dataset.delta);
      item.quantity = Math.max(1, (item.quantity || 1) + delta);
      saveData(data);
      // Update display without full re-render
      const card = btn.closest('.item-card, .item-tile');
      if (card) {
        card.querySelector('.qty-val').textContent = item.quantity;
        const qtyDisplay = card.querySelector('.item-qty');
        if (qtyDisplay) qtyDisplay.textContent = `×${item.quantity}`;
      }
      updateTopbarBomName();
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

  // Swipe-to-delete on list cards
  if (viewMode === 'list') {
    area.querySelectorAll('.item-card').forEach(card => {
      let startX = 0, startY = 0, curDx = 0, tracking = false;
      const itemId = card.querySelector('[data-id]')?.dataset.id;

      card.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        curDx = 0; tracking = true;
        card.classList.add('swiping');
      }, { passive: true });

      card.addEventListener('touchmove', e => {
        if (!tracking) return;
        const dx = e.touches[0].clientX - startX;
        const dy = Math.abs(e.touches[0].clientY - startY);
        if (dy > Math.abs(dx)) { tracking = false; card.style.transform = ''; return; }
        curDx = Math.min(0, dx); // only left swipe
        const clamped = Math.max(curDx, -120);
        card.style.transform = `translateX(${clamped}px)`;
        card.classList.toggle('swipe-delete', curDx < -80);
      }, { passive: true });

      card.addEventListener('touchend', () => {
        tracking = false;
        card.classList.remove('swiping');
        if (curDx < -80 && itemId) {
          card.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
          card.style.transform = 'translateX(-110%)';
          card.style.opacity = '0';
          setTimeout(() => deleteItem(itemId), 210);
        } else {
          card.style.transition = 'transform 0.25s ease';
          card.style.transform = '';
          card.classList.remove('swipe-delete');
        }
      });
    });
  }
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
    const priceStr = d.price ? ` · ${priceInDisplay(d.price, d.currency || '$')}` : '';
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
  if (bundle && bundle.price) {
    const coversN = (bundle.coversItemIds || []).length;
    bestPriceHtml = `<div class="item-best-price" style="color:var(--amber)">${priceInDisplay(bundle.price, bundle.currency || '$')}</div><div class="item-best-price-label">bundle${coversN > 1 ? ` · ${coversN} items` : ''}</div>`;
  } else if (cheapest) {
    bestPriceHtml = `<div class="item-best-price">${priceInDisplay(cheapest.price, cheapest.currency)}</div><div class="item-best-price-label">best price</div>`;
  } else {
    bestPriceHtml = `<div class="item-best-price" style="color:var(--text-muted)">—</div>`;
  }

  const status = item.status || 'needed';
  const statusBadge = `<span class="status-badge status-${status}">${STATUS_LABEL[status]}</span>`;
  const bundle = coveredByBundle(item.id, bom);
  const bundlePriceHtml = bundle ? formatBundlePrice(bundle) : '';
  const bundleBadge = bundle
    ? `<span class="bundle-badge">📦 ${esc(bundle.name)}${bundlePriceHtml ? ` · ${bundlePriceHtml}` : ''}</span>`
    : '';
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

function renderItemTile(item, bom) {
  const prices = getPrices(item);
  const cheapest = prices.length ? prices.reduce((a, b) => a.price < b.price ? a : b) : null;
  const status = item.status || 'needed';
  const bundle = coveredByBundle(item.id, bom);

  const imgContent = item.imageUrl
    ? `<img src="${esc(item.imageUrl)}" alt="" onerror="this.style.display='none'">`
    : '📦';

  let priceHtml = '';
  if (bundle) {
    const pHtml = formatBundlePrice(bundle);
    priceHtml = `<span class="item-tile-price" style="color:var(--amber)">📦 ${pHtml}</span>`;
  } else if (cheapest) {
    priceHtml = `<span class="item-tile-price">${priceInDisplay(cheapest.price, cheapest.currency)}</span>`;
  }

  const typeMeta = item.componentType
    ? `<span class="type-badge" style="font-size:0.6rem;padding:1px 6px">${esc(item.componentType)}</span>`
    : '';

  return `
    <div class="item-tile status-${status}">
      <div class="item-tile-rect">
        <div class="item-tile-top-row">
          <div class="item-tile-img">${imgContent}</div>
          <div class="item-tile-actions">
            <button class="item-tile-btn edit item-edit-btn" data-id="${item.id}" title="Edit">✏</button>
            <button class="item-tile-btn copy item-copy-btn" data-id="${item.id}" title="Copy to BOM">⎘</button>
            <button class="item-tile-btn del item-del-btn" data-id="${item.id}" title="Delete">✕</button>
          </div>
        </div>
        <div class="item-tile-qty-strip">
          <button class="qty-btn" data-id="${item.id}" data-delta="-1">−</button>
          <span class="qty-val">${item.quantity || 1}</span>
          <button class="qty-btn" data-id="${item.id}" data-delta="1">+</button>
        </div>
      </div>
      <div class="item-tile-info">
        <div class="item-tile-name">${esc(item.name)}</div>
        <div class="item-tile-meta">
          ${typeMeta}
          ${priceHtml}
          <span class="status-badge status-${status}" style="font-size:0.58rem;padding:1px 6px">${STATUS_LABEL[status]}</span>
        </div>
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

// ── Cross-BOM Compare ────────────────────────────────────────────────────────

function openCompareBomModal() {
  if (data.boms.length < 2) {
    alert('You need at least 2 BOMs to compare. Create another BOM first.');
    return;
  }

  let selectedIds = new Set(activeBomId ? [activeBomId] : [data.boms[0].id]);

  function bomPriceCell(bom, type) {
    const items = bom.items.filter(i => (i.componentType || '') === type);
    if (!items.length) return `<span style="color:var(--text-muted)">—</span>`;
    return items.map(item => {
      const bundle = coveredByBundle(item.id, bom);
      let priceStr = '';
      if (bundle?.price) {
        priceStr = `<span style="color:var(--amber)">📦 ${formatBundlePrice(bundle)}</span>`;
      } else {
        const prices = getPrices(item);
        if (prices.length) {
          const cheapest = prices.reduce((a, c) => a.price < c.price ? a : c);
          const qty = item.quantity || 1;
          const unitStr = priceInDisplay(cheapest.price, cheapest.currency);
          priceStr = `<span style="color:var(--green)">${unitStr}</span>${qty > 1 ? ` <small style="color:var(--text-muted);opacity:.7">×${qty}</small>` : ''}`;
        }
      }
      const statusDot = { received: '🟢', ordered: '🟡', needed: '🔴' }[item.status || 'needed'] || '';
      return `<div style="padding:2px 0;font-size:0.78rem">${statusDot} <strong>${esc(item.name)}</strong>${priceStr ? ' · ' + priceStr : ''}</div>`;
    }).join('');
  }

  function buildTable() {
    const boms = [...selectedIds].map(id => data.boms.find(b => b.id === id)).filter(Boolean);
    if (boms.length < 2) return `<p style="font-size:0.82rem;color:var(--text-muted);padding:16px">Select at least 2 BOMs to compare.</p>`;

    const allTypes = new Set();
    boms.forEach(b => b.items.forEach(i => allTypes.add(i.componentType || '')));
    const sortedTypes = [...allTypes].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b)));

    const header = `<tr>
      <th class="cmp-type-col">Type</th>
      ${boms.map(b => `<th class="cmp-proposal-col">${esc(b.name)}<br><small style="font-weight:400;color:var(--text-muted)">${b.items.length} item${b.items.length !== 1 ? 's' : ''}</small></th>`).join('')}
    </tr>`;

    const rows = sortedTypes.map(type => `<tr>
      <td class="cmp-type-col">${type ? `<span class="type-badge">${esc(type)}</span>` : `<span style="color:var(--text-muted);font-size:0.7rem">—</span>`}</td>
      ${boms.map(b => `<td class="cmp-data-col">${bomPriceCell(b, type)}</td>`).join('')}
    </tr>`).join('');

    // Totals with cheapest highlighted
    const totals = boms.map(b => {
      const t = calcBomTotal(b);
      const raw = calcBomTotalRaw(b);
      return { display: t, raw };
    });
    const minRaw = Math.min(...totals.map(t => t.raw ?? Infinity));
    const totalCells = totals.map(t => {
      const isBest = t.raw !== null && t.raw === minRaw && totals.filter(x => x.raw === minRaw).length < totals.length;
      return `<td class="cmp-data-col cmp-total-cell${isBest ? ' cmp-best' : ''}">${t.display}${isBest ? ' ✓' : ''}</td>`;
    }).join('');

    return `<div class="cmp-scroll"><table class="cmp-table">
      <thead>${header}</thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td class="cmp-type-col" style="font-weight:700;font-size:0.8rem">Total</td>${totalCells}</tr></tfoot>
    </table></div>`;
  }

  const checkboxes = data.boms.map(b => `
    <label style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-radius:8px;border:1px solid ${selectedIds.has(b.id) ? 'var(--accent)' : 'var(--border)'};background:${selectedIds.has(b.id) ? 'var(--accent-dim)' : 'transparent'};margin-bottom:6px;transition:all .15s">
      <input type="checkbox" name="cmp-bom" value="${b.id}" ${selectedIds.has(b.id) ? 'checked' : ''} style="accent-color:var(--accent)">
      <span style="font-weight:600;font-size:0.85rem">${esc(b.name)}</span>
      <span style="font-size:0.72rem;color:var(--text-muted);margin-left:auto">${b.items.length} items · ${calcBomTotal(b)}</span>
    </label>`).join('');

  const html = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal" style="max-width:92vw;width:92vw">
        <div class="modal-header">
          <h2>⚖ Compare BOMs</h2>
          <button class="modal-close" id="modal-close">✕</button>
        </div>
        <div class="modal-body" style="padding-bottom:0">
          <div style="margin-bottom:14px">
            <div style="font-size:0.72rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Select BOMs to compare</div>
            ${checkboxes}
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
  const close = () => overlay.remove();
  document.getElementById('modal-close').addEventListener('click', close);
  document.getElementById('modal-close2').addEventListener('click', close);

  overlay.querySelectorAll('input[name="cmp-bom"]').forEach(cb => {
    cb.addEventListener('change', e => {
      if (e.target.checked) selectedIds.add(e.target.value);
      else selectedIds.delete(e.target.value);
      // Update label styling
      overlay.querySelectorAll('input[name="cmp-bom"]').forEach(c => {
        const label = c.closest('label');
        label.style.borderColor = c.checked ? 'var(--accent)' : 'var(--border)';
        label.style.background = c.checked ? 'var(--accent-dim)' : 'transparent';
      });
      document.getElementById('compare-table-wrap').innerHTML = buildTable();
    });
  });
}

function calcBomTotalRaw(bom) {
  const bundleCounted = new Set();
  let total = 0, hasAny = false;
  for (const item of bom.items) {
    const bundle = coveredByBundle(item.id, bom);
    if (bundle) {
      if (!bundleCounted.has(bundle) && bundle.price) {
        bundleCounted.add(bundle);
        hasAny = true;
        const fromCode = codeOfSym(bundle.currency || '$');
        const conv = fromCode ? toDisplay(parseFloat(bundle.price), fromCode) : null;
        total += conv ? conv.amount : parseFloat(bundle.price);
      }
      continue;
    }
    const prices = getPrices(item);
    if (!prices.length) continue;
    const cheapest = prices.reduce((a, b) => a.price < b.price ? a : b);
    hasAny = true;
    const fromCode = codeOfSym(cheapest.currency);
    const conv = fromCode ? toDisplay(cheapest.price, fromCode) : null;
    total += (conv ? conv.amount : cheapest.price) * (item.quantity || 1);
  }
  return hasAny ? total : null;
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

function importFromCSV(rows) {
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

  // Detect spec field columns
  const specColMap = [];
  data.specFields.forEach(f => {
    const idx = header.findIndex(h => h.toLowerCase().startsWith(f.name.toLowerCase()));
    if (idx >= 0) specColMap.push({ field: f, colIdx: idx });
  });

  // Find end of items section
  let endIdx = rows.length;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const first = rows[i][0];
    if (first === 'BUNDLES' || first === 'PROPOSALS' || first === '') { endIdx = i; break; }
  }

  const items = [];
  const nameToId = {}; // for bundle reconstruction
  for (let i = headerIdx + 1; i < endIdx; i++) {
    const r = rows[i];
    const name = r[iName]?.trim();
    if (!name) continue;

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
        const rangeMatch = raw.replace(/[^\d.\-–]/g, '').match(/^([\d.]+)[–-]([\d.]+)$/);
        if (rangeMatch) specs[field.id] = { min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]) };
        else { const v = parseFloat(raw); if (!isNaN(v)) specs[field.id] = { value: v }; }
      }
    });

    const statusRaw = (r[iStatus] || '').toLowerCase();
    const status = statusRaw.includes('order') && !statusRaw.includes('need') ? 'ordered'
                 : statusRaw.includes('stock') || statusRaw.includes('receiv') ? 'received'
                 : 'needed';

    const id = uuid();
    nameToId[name.toLowerCase()] = id;
    items.push({
      id, name,
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

  // ── Parse BUNDLES section ──
  const bundles = [];
  const bundlesSectionIdx = rows.findIndex(r => r[0] === 'BUNDLES');
  if (bundlesSectionIdx >= 0) {
    const bHeader = rows[bundlesSectionIdx + 1];
    if (bHeader) {
      const bc = name => bHeader.findIndex(h => h.toLowerCase() === name.toLowerCase());
      const bName = bc('name'), bPlat = bc('platform'), bPrice = bc('price'),
            bCur  = bc('currency'), bUrl = bc('url'), bCovers = bc('covers items');
      for (let i = bundlesSectionIdx + 2; i < rows.length; i++) {
        const r = rows[i];
        if (!r[bName]?.trim()) break;
        const coveredNames = (r[bCovers] || '').split(';').map(s => s.trim()).filter(Boolean);
        const coversItemIds = coveredNames.map(n => nameToId[n.toLowerCase()]).filter(Boolean);
        bundles.push({
          id: uuid(),
          name: r[bName].trim(),
          platform: bPlat >= 0 ? r[bPlat]?.trim() || '' : '',
          price: bPrice >= 0 ? r[bPrice]?.trim() || '' : '',
          currency: bCur >= 0 ? r[bCur]?.trim() || '$' : '$',
          url: bUrl >= 0 ? r[bUrl]?.trim() || '' : '',
          coversItemIds,
        });
      }
    }
  }

  return { items, bundles };
}

// keep old name as alias for any callers
function importItemsFromCSV(rows) { return importFromCSV(rows); }

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
      const result = importFromCSV(rows);
      if (!result || !result.items.length) {
        alert('No items found in CSV. Make sure it was exported from BOM Tracker.');
        return;
      }
      openCSVImportModal(result.items, result.bundles, file.name);
    };
    reader.readAsText(file);
  });
  input.click();
}

function openCSVImportModal(items, bundles, filename) {
  bundles = bundles || [];
  const bom = getActiveBom();
  const bundleNote = bundles.length ? ` + <strong>${bundles.length} bundle(s)</strong>` : '';
  const html = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal" style="max-width:460px">
        <div class="modal-header">
          <h2>↑ Import CSV</h2>
          <button class="modal-close" id="modal-close">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:0.82rem;margin-bottom:14px">
            Found <strong>${items.length} item(s)</strong>${bundleNote} in <em>${esc(filename)}</em>.
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
            ${bundles.length ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">${bundles.map(b => `<div style="padding:2px 0">📦 ${esc(b.name)}</div>`).join('')}</div>` : ''}
          </div>
        </div>
        <div class="modal-footer">
          <button class="header-btn" id="modal-cancel">Cancel</button>
          <button class="header-btn primary" id="import-confirm">Import ${items.length} item(s)${bundles.length ? ` + ${bundles.length} bundle(s)` : ''}</button>
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

    // Build name→id map for items already in target BOM + newly imported items
    // (needed to remap bundle coversItemIds when merging into existing BOM)
    const importedNameToId = {};
    items.forEach(it => { importedNameToId[it.name.toLowerCase()] = it.id; });

    let added = 0, skipped = 0;
    for (const item of items) {
      if (skipDupes && targetBom.items.some(i => i.name.toLowerCase() === item.name.toLowerCase())) {
        skipped++;
        // point bundle refs to the existing item's id instead
        const existingId = targetBom.items.find(i => i.name.toLowerCase() === item.name.toLowerCase())?.id;
        if (existingId) importedNameToId[item.name.toLowerCase()] = existingId;
        continue;
      }
      targetBom.items.push(item);
      added++;
    }

    // Import bundles, remapping coversItemIds to final target IDs
    let bundlesAdded = 0;
    for (const b of bundles) {
      const remapped = {
        ...b,
        id: uuid(),
        coversItemIds: b.coversItemIds.map(id => {
          // find the original item name from the parsed items list, then remap
          const orig = items.find(it => it.id === id);
          if (!orig) return id;
          return importedNameToId[orig.name.toLowerCase()] || id;
        }),
      };
      targetBom.bundles = targetBom.bundles || [];
      targetBom.bundles.push(remapped);
      bundlesAdded++;
    }

    saveData(data);
    close();
    renderAll();
    const bundleMsg = bundlesAdded ? `, ${bundlesAdded} bundle(s)` : '';
    showToast(`Imported ${added} item(s)${bundleMsg}${skipped ? `, skipped ${skipped} duplicate(s)` : ''}`);
  });
}

// ── Export CSV ────────────────────────────────────────────────────────────────

function exportCSV() {
  const bom = getActiveBom();
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const row = cols => cols.map(q).join(',');
  const sections = [];

  // ── Items ──
  const specHeaders = data.specFields.map(f => `${f.name} (${f.unit || f.type})`);
  sections.push(row(['ITEMS']));
  sections.push(row(['Name', 'Component Type', 'Qty', 'Status', 'Notes', 'Image URL',
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
    sections.push(row([
      item.name, item.componentType || '', item.quantity || 1,
      STATUS_LABEL[item.status || 'needed'] || item.status || '',
      item.specsNotes || '', item.imageUrl || '',
      ...specValues,
      p.amazon?.url || '', p.amazon?.price || '', p.amazon?.currency || '',
      p.lazada?.url || '', p.lazada?.price || '', p.lazada?.currency || '',
      p.aliexpress?.url || '', p.aliexpress?.price || '', p.aliexpress?.currency || '',
      cheapest ? `${cheapest.currency}${cheapest.price}` : '',
      linkedNames,
    ]));
  }

  // ── Bundles ──
  if ((bom.bundles || []).length) {
    sections.push('');
    sections.push(row(['BUNDLES']));
    sections.push(row(['Name', 'Platform', 'Price', 'Currency', 'URL', 'Covers Items']));
    for (const b of bom.bundles) {
      const covered = (b.coversItemIds || []).map(id => bom.items.find(i => i.id === id)?.name || '').filter(Boolean).join('; ');
      sections.push(row([b.name, b.platform || '', b.price || '', b.currency || '$', b.url || '', covered]));
    }
  }

  const baseName = bom.name.replace(/[^a-z0-9]/gi, '_');
  downloadText(sections.join('\n'), `${baseName}.csv`, 'text/csv');
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

function formatBundlePrice(bundle) {
  if (!bundle?.price) return '';
  return priceInDisplay(bundle.price, bundle.currency || '$');
}

function calcBomTotal(bom) {
  const dc = getDisplayCurrency();
  let total = 0, hasAny = false, hasUnconverted = false;
  const bundleCounted = new Set(); // keyed by object reference

  for (const item of bom.items) {
    const bundle = coveredByBundle(item.id, bom);
    if (bundle) {
      if (!bundleCounted.has(bundle) && bundle.price) {
        bundleCounted.add(bundle);
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
    const details = [
      `${bom.items.length} item(s)`,
      bundleCount ? `${bundleCount} bundle(s)` : '',
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

    if (!bom.bundles) bom.bundles = [];
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

function renderAll() { updateTopbarBomName(); renderBomHeader(); }

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

document.getElementById('bom-picker-btn').addEventListener('click', openBomPickerModal);
document.getElementById('new-bom-btn').addEventListener('click', () => openBomModal());
document.getElementById('import-csv-btn').addEventListener('click', triggerCSVImport);
document.getElementById('export-csv-btn').addEventListener('click', () => { const bom = getActiveBom(); if (bom) exportCSV(); else alert('Select a BOM first'); });
if (data.boms.length > 0) activeBomId = data.boms[0].id;
renderAll();
checkShareParam();
fetchRates();
