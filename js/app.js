// ── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'bom-tracker-data';

function loadData() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { boms: [] }; }
  catch { return { boms: [] }; }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function uuid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ── State ─────────────────────────────────────────────────────────────────────

let data = loadData();
let activeBomId = null;

function getActiveBom() {
  return data.boms.find(b => b.id === activeBomId) || null;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function renderSidebar() {
  const list = document.getElementById('bom-list');
  if (data.boms.length === 0) {
    list.innerHTML = `<p style="padding:12px 8px;font-size:0.75rem;color:var(--text-muted)">No BOMs yet. Create one below.</p>`;
    return;
  }
  list.innerHTML = data.boms.map(bom => {
    const total = calcBomTotal(bom);
    const active = bom.id === activeBomId ? ' active' : '';
    return `
      <div class="bom-entry${active}" data-id="${bom.id}">
        <div class="bom-entry-name">${esc(bom.name)}</div>
        <div class="bom-entry-meta">${bom.items.length} item${bom.items.length !== 1 ? 's' : ''} · ${total}</div>
      </div>`;
  }).join('');

  list.querySelectorAll('.bom-entry').forEach(el => {
    el.addEventListener('click', () => {
      activeBomId = el.dataset.id;
      renderAll();
    });
  });
}

// ── BOM header ────────────────────────────────────────────────────────────────

function renderBomHeader() {
  const bom = getActiveBom();
  const header = document.getElementById('bom-header');
  const main = document.getElementById('main');

  if (!bom) {
    main.innerHTML = `
      <div id="no-bom">
        <div class="icon">📋</div>
        <h2>Select or create a BOM</h2>
        <p>Use the sidebar to get started</p>
      </div>`;
    return;
  }

  const total = calcBomTotal(bom);
  const itemCount = bom.items.reduce((s, i) => s + (i.quantity || 1), 0);

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
      <button class="header-btn" id="export-csv-btn">Export CSV</button>
      <button class="header-btn danger" id="delete-bom-btn">Delete BOM</button>
    </div>
    <div id="items-area"></div>`;

  document.getElementById('edit-bom-btn').addEventListener('click', () => openBomModal(bom));
  document.getElementById('add-item-btn').addEventListener('click', () => openItemModal(null));
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
  document.getElementById('delete-bom-btn').addEventListener('click', deleteBom);

  renderItems();
}

// ── Items ─────────────────────────────────────────────────────────────────────

function renderItems() {
  const bom = getActiveBom();
  const area = document.getElementById('items-area');
  if (!area) return;

  if (bom.items.length === 0) {
    area.innerHTML = `
      <div id="empty-state">
        <div class="icon">🔩</div>
        <h2>No items yet</h2>
        <p>Click "+ Add Item" to add your first component</p>
      </div>`;
    return;
  }

  area.innerHTML = bom.items.map(item => renderItemCard(item)).join('');

  area.querySelectorAll('.item-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = bom.items.find(i => i.id === btn.dataset.id);
      if (item) openItemModal(item);
    });
  });

  area.querySelectorAll('.item-del-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteItem(btn.dataset.id));
  });
}

function renderItemCard(item) {
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

  const bestPriceHtml = cheapest
    ? `<div class="item-best-price">${cheapest.currency}${cheapest.price}</div>
       <div class="item-best-price-label">best price</div>`
    : `<div class="item-best-price" style="color:var(--text-muted)">—</div>`;

  return `
    <div class="item-card">
      ${imgHtml}
      <div class="item-body">
        <div class="item-top">
          <div class="item-name">${esc(item.name)}</div>
          <div class="item-qty">×${item.quantity || 1}</div>
        </div>
        ${item.specs ? `<div class="item-specs">${esc(item.specs)}</div>` : ''}
        <div class="item-links">${platformBtns || '<span style="font-size:0.75rem;color:var(--text-muted)">No links added</span>'}</div>
      </div>
      <div class="item-actions">
        ${bestPriceHtml}
        <button class="item-edit-btn" data-id="${item.id}">Edit</button>
        <button class="item-del-btn" data-id="${item.id}">Del</button>
      </div>
    </div>`;
}

// ── Calc ──────────────────────────────────────────────────────────────────────

function getPrices(item) {
  const out = [];
  ['amazon', 'lazada', 'aliexpress'].forEach(p => {
    const d = item.platforms?.[p];
    if (d?.price && d?.url) {
      out.push({ platform: p, price: parseFloat(d.price), currency: d.currency || '$' });
    }
  });
  return out;
}

function calcBomTotal(bom) {
  let total = 0;
  let currency = '$';
  let mixed = false;

  for (const item of bom.items) {
    const prices = getPrices(item);
    if (!prices.length) continue;
    const cheapest = prices.reduce((a, b) => a.price < b.price ? a : b);
    if (currency === '$') currency = cheapest.currency;
    else if (currency !== cheapest.currency) mixed = true;
    total += cheapest.price * (item.quantity || 1);
  }

  if (total === 0) return 'No prices';
  return (mixed ? '~' : '') + currency + total.toFixed(2);
}

// ── Modals ────────────────────────────────────────────────────────────────────

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
  document.getElementById('modal-close').addEventListener('click', () => overlay.remove());
  document.getElementById('modal-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('bom-name-input').focus();

  document.getElementById('modal-save').addEventListener('click', () => {
    const name = document.getElementById('bom-name-input').value.trim();
    if (!name) return alert('Name is required');
    if (isEdit) {
      existing.name = name;
      existing.description = document.getElementById('bom-desc-input').value.trim();
    } else {
      const bom = { id: uuid(), name, description: document.getElementById('bom-desc-input').value.trim(), items: [], createdAt: Date.now() };
      data.boms.push(bom);
      activeBomId = bom.id;
    }
    saveData(data);
    overlay.remove();
    renderAll();
  });
}

function openItemModal(existing = null) {
  const isEdit = !!existing;
  const p = existing?.platforms || {};

  const html = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal">
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
            <div class="form-group" style="max-width:100px">
              <label>Quantity</label>
              <input type="number" id="item-qty" min="1" value="${existing?.quantity || 1}">
            </div>
          </div>
          <div class="form-group">
            <label>Specs / Notes</label>
            <textarea id="item-specs" placeholder="4GB RAM, USB-C power, GPIO 40-pin...">${esc(existing?.specs || '')}</textarea>
          </div>
          <div class="form-group">
            <label>Image URL</label>
            <input type="url" id="item-img" placeholder="https://..." value="${esc(existing?.imageUrl || '')}">
            <img id="img-preview" class="img-preview" src="" alt="">
          </div>

          <div class="platform-section">
            <div class="platform-section-title"><span class="platform-dot dot-amazon"></span> Amazon</div>
            <div class="form-row">
              <div class="form-group">
                <label>Link</label>
                <input type="url" id="amazon-url" placeholder="https://amazon.com/..." value="${esc(p.amazon?.url || '')}">
              </div>
              <div class="form-group" style="max-width:100px">
                <label>Price</label>
                <input type="number" id="amazon-price" step="0.01" min="0" placeholder="0.00" value="${p.amazon?.price || ''}">
              </div>
              <div class="form-group" style="max-width:80px">
                <label>Currency</label>
                <input type="text" id="amazon-currency" placeholder="$" maxlength="5" value="${esc(p.amazon?.currency || '$')}">
              </div>
            </div>
          </div>

          <div class="platform-section">
            <div class="platform-section-title"><span class="platform-dot dot-lazada"></span> Lazada</div>
            <div class="form-row">
              <div class="form-group">
                <label>Link</label>
                <input type="url" id="lazada-url" placeholder="https://lazada.com/..." value="${esc(p.lazada?.url || '')}">
              </div>
              <div class="form-group" style="max-width:100px">
                <label>Price</label>
                <input type="number" id="lazada-price" step="0.01" min="0" placeholder="0.00" value="${p.lazada?.price || ''}">
              </div>
              <div class="form-group" style="max-width:80px">
                <label>Currency</label>
                <input type="text" id="lazada-currency" placeholder="$" maxlength="5" value="${esc(p.lazada?.currency || '$')}">
              </div>
            </div>
          </div>

          <div class="platform-section">
            <div class="platform-section-title"><span class="platform-dot dot-aliexpress"></span> AliExpress</div>
            <div class="form-row">
              <div class="form-group">
                <label>Link</label>
                <input type="url" id="aliexpress-url" placeholder="https://aliexpress.com/..." value="${esc(p.aliexpress?.url || '')}">
              </div>
              <div class="form-group" style="max-width:100px">
                <label>Price</label>
                <input type="number" id="aliexpress-price" step="0.01" min="0" placeholder="0.00" value="${p.aliexpress?.price || ''}">
              </div>
              <div class="form-group" style="max-width:80px">
                <label>Currency</label>
                <input type="text" id="aliexpress-currency" placeholder="$" maxlength="5" value="${esc(p.aliexpress?.currency || '$')}">
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="header-btn" id="modal-cancel">Cancel</button>
          <button class="header-btn primary" id="modal-save">${isEdit ? 'Save' : 'Add'}</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-overlay');

  // Image preview
  const imgInput = document.getElementById('item-img');
  const imgPreview = document.getElementById('img-preview');
  if (existing?.imageUrl) { imgPreview.src = existing.imageUrl; imgPreview.style.display = 'block'; }
  imgInput.addEventListener('input', () => {
    const url = imgInput.value.trim();
    if (url) { imgPreview.src = url; imgPreview.style.display = 'block'; }
    else imgPreview.style.display = 'none';
  });

  document.getElementById('modal-close').addEventListener('click', () => overlay.remove());
  document.getElementById('modal-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('item-name').focus();

  document.getElementById('modal-save').addEventListener('click', () => {
    const name = document.getElementById('item-name').value.trim();
    if (!name) return alert('Name is required');

    const item = existing || { id: uuid() };
    item.name = name;
    item.quantity = parseInt(document.getElementById('item-qty').value) || 1;
    item.specs = document.getElementById('item-specs').value.trim();
    item.imageUrl = document.getElementById('item-img').value.trim();
    item.platforms = {
      amazon: {
        url: document.getElementById('amazon-url').value.trim(),
        price: document.getElementById('amazon-price').value,
        currency: document.getElementById('amazon-currency').value.trim() || '$'
      },
      lazada: {
        url: document.getElementById('lazada-url').value.trim(),
        price: document.getElementById('lazada-price').value,
        currency: document.getElementById('lazada-currency').value.trim() || '$'
      },
      aliexpress: {
        url: document.getElementById('aliexpress-url').value.trim(),
        price: document.getElementById('aliexpress-price').value,
        currency: document.getElementById('aliexpress-currency').value.trim() || '$'
      }
    };

    const bom = getActiveBom();
    if (!isEdit) bom.items.push(item);

    saveData(data);
    overlay.remove();
    renderAll();
  });
}

// ── Delete ────────────────────────────────────────────────────────────────────

function deleteItem(itemId) {
  if (!confirm('Delete this item?')) return;
  const bom = getActiveBom();
  bom.items = bom.items.filter(i => i.id !== itemId);
  saveData(data);
  renderAll();
}

function deleteBom() {
  const bom = getActiveBom();
  if (!confirm(`Delete "${bom.name}" and all its items?`)) return;
  data.boms = data.boms.filter(b => b.id !== activeBomId);
  activeBomId = data.boms[0]?.id || null;
  saveData(data);
  renderAll();
}

// ── Export CSV ────────────────────────────────────────────────────────────────

function exportCSV() {
  const bom = getActiveBom();
  const rows = [['Name', 'Quantity', 'Specs', 'Image URL', 'Amazon URL', 'Amazon Price', 'Amazon Currency', 'Lazada URL', 'Lazada Price', 'Lazada Currency', 'AliExpress URL', 'AliExpress Price', 'AliExpress Currency', 'Best Price']];
  for (const item of bom.items) {
    const prices = getPrices(item);
    const cheapest = prices.length ? prices.reduce((a, b) => a.price < b.price ? a : b) : null;
    const p = item.platforms || {};
    rows.push([
      item.name, item.quantity || 1, item.specs || '',
      item.imageUrl || '',
      p.amazon?.url || '', p.amazon?.price || '', p.amazon?.currency || '',
      p.lazada?.url || '', p.lazada?.price || '', p.lazada?.currency || '',
      p.aliexpress?.url || '', p.aliexpress?.price || '', p.aliexpress?.currency || '',
      cheapest ? `${cheapest.currency}${cheapest.price}` : ''
    ]);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `${bom.name.replace(/[^a-z0-9]/gi, '_')}_BOM.csv`;
  a.click();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderAll() {
  renderSidebar();
  renderBomHeader();
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.getElementById('new-bom-btn').addEventListener('click', () => openBomModal());

if (data.boms.length > 0) activeBomId = data.boms[0].id;

renderAll();
