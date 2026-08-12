import { getActiveBom, state } from '../data.js';
import { renderItems } from './items.js';
import { openBomModal, openBundlesModal, openCompareBomModal, openItemModal, openSpecFieldsModal } from './modals.js';
import { calcBomTotal, deleteBom, esc, shareBom } from '../utils.js';

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function updateTopbarBomName() {
  const bom = getActiveBom();
  const el = document.getElementById('topbar-bom-name');
  if (el) el.textContent = bom ? bom.name : 'Select BOM';
}

export function openBomPickerModal() {
  const html = `
    <div class="modal-overlay" id="bom-picker-overlay">
      <div class="modal" style="max-width:340px">
        <div class="modal-header">
          <h2>📋 BOMs</h2>
          <button class="modal-close" id="bom-picker-close">✕</button>
        </div>
        <div class="modal-body" style="padding:8px">
          ${state.data.boms.length ? state.data.boms.map(b => `
            <div class="bom-entry${b.id === state.activeBomId ? ' active' : ''}" data-id="${b.id}">
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
    el.addEventListener('click', () => { state.activeBomId = el.dataset.id; close(); renderAll(); })
  );
  document.getElementById('bom-picker-new').addEventListener('click', () => { close(); openBomModal(null); });
}

// ── BOM header + main ─────────────────────────────────────────────────────────

export function renderBomHeader() {
  const bom = getActiveBom();
  const main = document.getElementById('main');
  if (!bom) {
    main.innerHTML = `
      <div id="no-bom">
        <div class="no-bom-icon">📋</div>
        <h2>${state.data.boms.length ? 'Select a BOM' : 'Welcome to BOM Tracker'}</h2>
        <p>${state.data.boms.length
          ? 'Tap the BOM picker at the top to switch between your bills of materials.'
          : 'Track components, compare prices across suppliers, and manage procurement for your projects.'}</p>
        <button class="header-btn primary" id="no-bom-create-btn">
          ${state.data.boms.length ? '📋 Open BOM picker' : '+ Create your first BOM'}
        </button>
      </div>`;
    document.getElementById('no-bom-create-btn').addEventListener('click',
      () => state.data.boms.length ? openBomPickerModal() : openBomModal(null)
    );
    return;
  }

  const total = calcBomTotal(bom);
  const itemCount = bom.items.reduce((s, i) => s + (i.quantity || 1), 0);
  const field = state.data.specFields.find(f => f.id === state.filterState.fieldId);
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
      <div class="bom-progress" style="width: 100%; margin-top: 10px;">
        <div class="bom-progress-received" style="width: ${bom.items.length ? (bom.items.filter(i => i.status === 'received').length / bom.items.length * 100) : 0}%"></div>
        <div class="bom-progress-ordered" style="width: ${bom.items.length ? (bom.items.filter(i => i.status === 'ordered').length / bom.items.length * 100) : 0}%"></div>
      </div>
      <button class="header-btn" id="edit-bom-btn" title="Edit BOM">✏ <span class="btn-text">Edit</span></button>
      <button class="header-btn primary" id="add-item-btn" title="Add Item">+ <span class="btn-text">Add Item</span></button>
      <button class="header-btn secondary-action" id="manage-bundles-btn" title="Manage Bundles">📦 <span class="btn-text">Bundles</span></button>
      <button class="header-btn secondary-action" id="compare-btn" title="Compare Proposals">⚖ <span class="btn-text">Compare</span></button>
      <button class="header-btn secondary-action" id="manage-specs-btn" title="Manage Spec Fields">⚙ <span class="btn-text">Specs</span></button>
      <button class="header-btn secondary-action" id="share-bom-btn" title="Share BOM">🔗 <span class="btn-text">Share</span></button>
      <button class="header-btn secondary-action" id="print-bom-btn" title="Print BOM">🖨 <span class="btn-text">Print</span></button>
      <button class="header-btn danger" id="delete-bom-btn" title="Delete BOM">🗑 <span class="btn-text">Delete</span></button>
      <button class="header-btn more-actions-btn" id="more-actions-btn" style="display: none;" title="More Actions">⋮</button>
      <div id="more-actions-menu" class="more-actions-menu"></div>
    </div>
    <div id="filter-bar">
      <select id="filter-field">
        <option value="">Filter by spec…</option>
        ${state.data.specFields.map(f => `<option value="${f.id}" ${f.id === state.filterState.fieldId ? 'selected' : ''}>${esc(f.name)} (${f.type})</option>`).join('')}
      </select>
      ${field ? `
        ${filterIsRange ? `
          <input type="number" id="filter-val" placeholder="min value" value="${esc(state.filterState.value)}" style="width:110px">
          <span style="color:var(--text-muted);font-size:0.8rem">–</span>
          <input type="number" id="filter-val2" placeholder="max (opt)" value="${esc(state.filterState.value2)}" style="width:110px">
          <span style="font-size:0.75rem;color:var(--text-muted)">${esc(field.unit)}</span>
        ` : `
          <input type="${field.type === 'text' ? 'text' : 'number'}" id="filter-val" placeholder="value" value="${esc(state.filterState.value)}" style="width:140px">
          ${field.unit ? `<span style="font-size:0.75rem;color:var(--text-muted)">${esc(field.unit)}</span>` : ''}
        `}
        <button class="header-btn primary" id="apply-filter-btn">Filter</button>
        <button class="header-btn" id="clear-filter-btn">✕ Clear</button>
      ` : ''}
    </div>
    <div id="items-toolbar">
      <input type="text" id="item-search" placeholder="Search items…" value="${esc(state.searchQuery)}">
      <select id="sort-select">
        <option value="default" ${!state.filterState.sort || state.filterState.sort==='default'?'selected':''}>Order added</option>
        <option value="name" ${state.filterState.sort==='name'?'selected':''}>Name A–Z</option>
        <option value="price" ${state.filterState.sort==='price'?'selected':''}>Price: low–high</option>
        <option value="status" ${state.filterState.sort==='status'?'selected':''}>Status</option>
      </select>
      <button id="view-toggle-btn" class="${state.viewMode !== 'list' ? 'active' : ''}" title="Switch view">${state.viewMode === 'list' ? '⊞ Tiles' : state.viewMode === 'tile' ? '⬡ Graph' : '≡ List'}</button>
      <span id="toolbar-total">${total}</span>
    </div>
    <div id="items-area"></div>`;

  document.getElementById('edit-bom-btn').addEventListener('click', () => openBomModal(bom));
  document.getElementById('add-item-btn').addEventListener('click', () => openItemModal(null));
  document.getElementById('manage-bundles-btn').addEventListener('click', openBundlesModal);
  document.getElementById('compare-btn').addEventListener('click', openCompareBomModal);
  document.getElementById('manage-specs-btn').addEventListener('click', openSpecFieldsModal);
  document.getElementById('share-bom-btn').addEventListener('click', shareBom);
  document.getElementById('print-bom-btn').addEventListener('click', () => window.print());
  document.getElementById('delete-bom-btn').addEventListener('click', deleteBom);

  const moreBtn = document.getElementById('more-actions-btn');
  const moreMenu = document.getElementById('more-actions-menu');
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (moreMenu.classList.contains('active')) {
      moreMenu.classList.remove('active');
      moreMenu.innerHTML = '';
    } else {
      moreMenu.classList.add('active');
      const cloneBtn = (id, text, handler) => {
        const btn = document.createElement('button');
        btn.className = 'header-btn';
        btn.innerHTML = text;
        btn.addEventListener('click', handler);
        return btn;
      };
      moreMenu.appendChild(cloneBtn('manage-bundles-btn', '📦 Bundles', openBundlesModal));
      moreMenu.appendChild(cloneBtn('compare-btn', '⚖ Compare', openCompareBomModal));
      moreMenu.appendChild(cloneBtn('manage-specs-btn', '⚙ Specs', openSpecFieldsModal));
      moreMenu.appendChild(cloneBtn('share-bom-btn', '🔗 Share', shareBom));
      moreMenu.appendChild(cloneBtn('print-bom-btn', '🖨 Print', () => window.print()));
    }
  });
  document.addEventListener('click', (e) => {
    if (!moreMenu.contains(e.target) && e.target !== moreBtn) {
      moreMenu.classList.remove('active');
      moreMenu.innerHTML = '';
    }
  });

  document.getElementById('item-search').addEventListener('input', e => {
    state.searchQuery = e.target.value;
    renderItems();
  });

  document.getElementById('sort-select').addEventListener('change', e => {
    state.filterState.sort = e.target.value;
    renderItems();
  });

  document.getElementById('view-toggle-btn').addEventListener('click', () => {
    state.viewMode = state.viewMode === 'list' ? 'tile' : state.viewMode === 'tile' ? 'graph' : 'list';
    localStorage.setItem('bom-view-mode', state.viewMode);
    const btn = document.getElementById('view-toggle-btn');
    btn.textContent = state.viewMode === 'list' ? '⊞ Tiles' : state.viewMode === 'tile' ? '⬡ Graph' : '≡ List';
    btn.classList.toggle('active', state.viewMode !== 'list');
    renderItems();
  });

  document.getElementById('filter-field').addEventListener('change', e => {
    state.filterState = { fieldId: e.target.value, value: '', value2: '', sort: state.filterState.sort };
    renderBomHeader();
  });

  document.getElementById('apply-filter-btn')?.addEventListener('click', () => {
    state.filterState.value = document.getElementById('filter-val')?.value || '';
    state.filterState.value2 = document.getElementById('filter-val2')?.value || '';
    renderItems();
  });

  document.getElementById('clear-filter-btn')?.addEventListener('click', () => {
    state.filterState = { fieldId: state.filterState.fieldId, value: '', value2: '' };
    document.getElementById('filter-val').value = '';
    if (document.getElementById('filter-val2')) document.getElementById('filter-val2').value = '';
    renderItems();
  });

  renderItems();
}
// ── Render ────────────────────────────────────────────────────────────────────

export function renderAll() { updateTopbarBomName(); renderBomHeader(); }
