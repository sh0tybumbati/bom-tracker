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
      <button class="header-btn" id="manage-specs-btn">⚙ Specs</button>
      <button class="header-btn" id="export-csv-btn">Export CSV</button>
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
    <div id="items-area"></div>`;

  document.getElementById('edit-bom-btn').addEventListener('click', () => openBomModal(bom));
  document.getElementById('add-item-btn').addEventListener('click', () => openItemModal(null));
  document.getElementById('manage-specs-btn').addEventListener('click', openSpecFieldsModal);
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
  document.getElementById('delete-bom-btn').addEventListener('click', deleteBom);

  document.getElementById('filter-field').addEventListener('change', e => {
    filterState = { fieldId: e.target.value, value: '', value2: '' };
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

  const filtered = bom.items.filter(itemMatchesFilter);

  if (!bom.items.length) {
    area.innerHTML = `<div id="empty-state"><div class="icon">🔩</div><h2>No items yet</h2><p>Click "+ Add Item" to start</p></div>`;
    return;
  }

  if (!filtered.length) {
    area.innerHTML = `<div id="empty-state"><div class="icon">🔍</div><h2>No items match filter</h2><p>Try different values</p></div>`;
    return;
  }

  area.innerHTML = filtered.map(item => renderItemCard(item, bom)).join('');

  area.querySelectorAll('.item-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      const item = bom.items.find(i => i.id === btn.dataset.id);
      if (item) openItemModal(item);
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
    const priceStr = d.price ? ` · ${d.currency || '$'}${d.price}` : '';
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

  const bestPriceHtml = cheapest
    ? `<div class="item-best-price">${cheapest.currency}${cheapest.price}</div><div class="item-best-price-label">best price</div>`
    : `<div class="item-best-price" style="color:var(--text-muted)">—</div>`;

  return `
    <div class="item-card">
      ${imgHtml}
      <div class="item-body">
        <div class="item-top">
          <div class="item-name">${esc(item.name)}</div>
          <div class="item-qty">×${item.quantity || 1}</div>
        </div>
        ${specChips ? `<div class="spec-chips">${specChips}</div>` : ''}
        ${item.specsNotes ? `<div class="item-specs">${esc(item.specsNotes)}</div>` : ''}
        <div class="item-links">${platformBtns || '<span style="font-size:0.75rem;color:var(--text-muted)">No links added</span>'}</div>
        ${linkedHtml ? `<div class="compat-row">${linkedHtml}</div>` : ''}
      </div>
      <div class="item-actions">
        ${bestPriceHtml}
        <button class="item-edit-btn" data-id="${item.id}">Edit</button>
        <button class="item-del-btn" data-id="${item.id}">Del</button>
      </div>
    </div>`;
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
          <div class="form-row">
            <div class="form-group">
              <label>Item Name</label>
              <input type="text" id="item-name" placeholder="e.g. Raspberry Pi 4B" value="${esc(existing?.name || '')}">
            </div>
            <div class="form-group" style="max-width:90px">
              <label>Qty</label>
              <input type="number" id="item-qty" min="1" value="${existing?.quantity || 1}">
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

// ── Export CSV ────────────────────────────────────────────────────────────────

function exportCSV() {
  const bom = getActiveBom();
  const specHeaders = data.specFields.map(f => `${f.name} (${f.unit || f.type})`);
  const rows = [['Name', 'Qty', 'Notes', 'Image URL', ...specHeaders, 'Amazon URL', 'Amazon Price', 'Amazon Currency', 'Lazada URL', 'Lazada Price', 'Lazada Currency', 'AliExpress URL', 'AliExpress Price', 'AliExpress Currency', 'Best Price', 'Linked Parts']];
  for (const item of bom.items) {
    const prices = getPrices(item);
    const cheapest = prices.length ? prices.reduce((a, b) => a.price < b.price ? a : b) : null;
    const p = item.platforms || {};
    const specValues = data.specFields.map(f => formatSpec(item.specs?.[f.id], f));
    const linkedNames = (item.linkedParts || []).map(id => bom.items.find(i => i.id === id)?.name || '').filter(Boolean).join('; ');
    rows.push([item.name, item.quantity || 1, item.specsNotes || '', item.imageUrl || '',
      ...specValues,
      p.amazon?.url || '', p.amazon?.price || '', p.amazon?.currency || '',
      p.lazada?.url || '', p.lazada?.price || '', p.lazada?.currency || '',
      p.aliexpress?.url || '', p.aliexpress?.price || '', p.aliexpress?.currency || '',
      cheapest ? `${cheapest.currency}${cheapest.price}` : '',
      linkedNames,
    ]);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `${bom.name.replace(/[^a-z0-9]/gi, '_')}_BOM.csv`;
  a.click();
}

// ── Calc ──────────────────────────────────────────────────────────────────────

function getPrices(item) {
  return ['amazon', 'lazada', 'aliexpress']
    .map(p => { const d = item.platforms?.[p]; return d?.price && d?.url ? { platform: p, price: parseFloat(d.price), currency: d.currency || '$' } : null; })
    .filter(Boolean);
}

function calcBomTotal(bom) {
  let total = 0, currency = '$', mixed = false;
  for (const item of bom.items) {
    const prices = getPrices(item);
    if (!prices.length) continue;
    const cheapest = prices.reduce((a, b) => a.price < b.price ? a : b);
    if (currency === '$') currency = cheapest.currency;
    else if (currency !== cheapest.currency) mixed = true;
    total += cheapest.price * (item.quantity || 1);
  }
  return total === 0 ? 'No prices' : (mixed ? '~' : '') + currency + total.toFixed(2);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderAll() { renderSidebar(); renderBomHeader(); }

// ── Init ──────────────────────────────────────────────────────────────────────

document.getElementById('new-bom-btn').addEventListener('click', () => openBomModal());
if (data.boms.length > 0) activeBomId = data.boms[0].id;
renderAll();
