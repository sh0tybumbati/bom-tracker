import { codeOfSym, priceInDisplay, toDisplay } from '../currency.js';
import { getActiveBom, saveData, state, uuid } from '../data.js';
import { fetchProductData } from './autofill.js';
import { renderAll } from './render.js';
import { calcBomTotal, coveredByBundle, esc, formatBundlePrice, getPrices, showToast } from '../utils.js';

// ── Copy item to BOM ──────────────────────────────────────────────────────────

export function openCopyItemModal(item) {
  const otherBoms = state.data.boms.filter(b => b.id !== state.activeBomId);
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
    const target = state.data.boms.find(b => b.id === targetId);
    if (!target) return;
    const copy = JSON.parse(JSON.stringify(item));
    copy.id = uuid();
    copy.linkedParts = []; // links don't transfer across BOMs
    target.items.push(copy);
    saveData(state.data);
    close();
    showToast(`Copied "${item.name}" to "${target.name}"`);
  });
}

// ── BOM modal ─────────────────────────────────────────────────────────────────

export function openBomModal(existing = null) {
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
      state.data.boms.push(bom);
      state.activeBomId = bom.id;
    }
    saveData(state.data); close(); renderAll();
  });
}

// ── Item modal ────────────────────────────────────────────────────────────────

export function openItemModal(existing = null) {
  const isEdit = !!existing;
  const p = existing?.platforms || {};
  const bom = getActiveBom();
  const otherItems = bom.items.filter(i => i.id !== existing?.id);

  const makeSpecInputs = (section, existingSpecs, fields) => (fields || state.data.specFields).map(f => {
    const s = existingSpecs?.[f.id] || {};
    const si = (key, extra = '') =>
      `<input type="number" class="spec-input" data-section="${section}" data-field="${f.id}" data-key="${key}" ${extra}>`;
    const st = () =>
      `<input type="text" class="spec-input" data-section="${section}" data-field="${f.id}" data-key="text" placeholder="e.g. JST-XH" value="${esc(s.text || '')}">`;
    if (f.type === 'range') return `
      <div class="spec-field-row">
        <span class="spec-field-label">${esc(f.name)} <span class="spec-unit">${esc(f.unit)}</span></span>
        <div class="spec-range-inputs">
          ${si('min', `placeholder="min" value="${s.min ?? ''}"`)}<span class="range-dash">–</span>${si('max', `placeholder="max" value="${s.max ?? ''}"`)}<span style="font-size:0.7rem;color:var(--text-muted);white-space:nowrap">or:</span>${si('value', `placeholder="exact" value="${s.value ?? ''}" style="width:70px"`)}
        </div>
      </div>`;
    if (f.type === 'value') return `
      <div class="spec-field-row">
        <span class="spec-field-label">${esc(f.name)} <span class="spec-unit">${esc(f.unit)}</span></span>
        ${si('value', `placeholder="value" value="${s.value ?? ''}"`)}</div>`;
    return `
      <div class="spec-field-row">
        <span class="spec-field-label">${esc(f.name)}</span>${st()}</div>`;
  }).join('');
  const dirFields = state.data.specFields.filter(f => f.directional);
  const genFields = state.data.specFields.filter(f => !f.directional);

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
            <div class="form-group" style="max-width:75px">
              <label>Qty</label>
              <input type="number" id="item-qty" min="1" value="${existing?.quantity || 1}">
            </div>
            <div class="form-group" style="max-width:75px">
              <label>Stock</label>
              <input type="number" id="item-stock" min="0" value="${existing?.stock || 0}">
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
            <div class="form-group" style="flex:none;align-self:flex-end;padding-bottom:2px">
              <label class="supply-checkbox-label">
                <input type="checkbox" id="item-is-supply" ${existing?.isSupply ? 'checked' : ''}>
                ⚡ Supply
              </label>
            </div>
          </div>

          <div class="form-group">
            <label>Image URL</label>
            <input type="url" id="item-img" placeholder="https://..." value="${esc(existing?.imageUrl || '')}">
            <img id="img-preview" class="img-preview" src="${esc(existing?.imageUrl || '')}" alt="" style="${existing?.imageUrl ? 'display:block' : 'display:none'}">
          </div>

          ${dirFields.length ? `
          <div class="spec-io-grid">
            <div class="spec-io-col">
              <div class="modal-section-title spec-in-title">📥 Input <span class="spec-io-hint">what it needs</span></div>
              <div id="spec-fields-in">${makeSpecInputs('in', existing?.inputSpecs, dirFields)}</div>
            </div>
            <div class="spec-io-col">
              <div class="modal-section-title spec-out-title">📤 Output <span class="spec-io-hint">what it provides</span></div>
              <div id="spec-fields-out">${makeSpecInputs('out', existing?.outputSpecs, dirFields)}</div>
            </div>
          </div>` : ''}
          ${genFields.length ? `
          <div class="modal-section-title" style="margin-top:12px">Specifications</div>
          <div id="spec-fields-gen">${makeSpecInputs('gen', existing?.specs, genFields)}</div>` : ''}
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
            <input type="text" id="amazon-notes" placeholder="Supplier notes…" style="font-size:0.78rem;margin-top:0" value="${esc(p.amazon?.notes || '')}">
          </div>
          <div class="platform-section">
            <div class="platform-section-title"><span class="platform-dot dot-lazada"></span> Lazada</div>
            <div class="form-row">
              <div class="form-group"><label>Link</label><input type="url" id="lazada-url" placeholder="https://lazada.com/..." value="${esc(p.lazada?.url || '')}"></div>
              <div class="form-group" style="max-width:90px"><label>Price</label><input type="number" id="lazada-price" step="0.01" min="0" value="${p.lazada?.price || ''}"></div>
              <div class="form-group" style="max-width:70px"><label>Currency</label><input type="text" id="lazada-currency" maxlength="5" value="${esc(p.lazada?.currency || '$')}"></div>
            </div>
            <input type="text" id="lazada-notes" placeholder="Supplier notes…" style="font-size:0.78rem;margin-top:0" value="${esc(p.lazada?.notes || '')}">
          </div>
          <div class="platform-section">
            <div class="platform-section-title"><span class="platform-dot dot-aliexpress"></span> AliExpress</div>
            <div class="form-row">
              <div class="form-group"><label>Link</label><input type="url" id="aliexpress-url" placeholder="https://aliexpress.com/..." value="${esc(p.aliexpress?.url || '')}"></div>
              <div class="form-group" style="max-width:90px"><label>Price</label><input type="number" id="aliexpress-price" step="0.01" min="0" value="${p.aliexpress?.price || ''}"></div>
              <div class="form-group" style="max-width:70px"><label>Currency</label><input type="text" id="aliexpress-currency" maxlength="5" value="${esc(p.aliexpress?.currency || '$')}"></div>
            </div>
            <input type="text" id="aliexpress-notes" placeholder="Supplier notes…" style="font-size:0.78rem;margin-top:0" value="${esc(p.aliexpress?.notes || '')}">
          </div>
          <div class="platform-section">
            <div class="platform-section-title"><span class="platform-dot dot-ebay"></span> eBay</div>
            <div class="form-row">
              <div class="form-group"><label>Link</label><input type="url" id="ebay-url" placeholder="https://ebay.com/..." value="${esc(p.ebay?.url || '')}"></div>
              <div class="form-group" style="max-width:90px"><label>Price</label><input type="number" id="ebay-price" step="0.01" min="0" value="${p.ebay?.price || ''}"></div>
              <div class="form-group" style="max-width:70px"><label>Currency</label><input type="text" id="ebay-currency" maxlength="5" value="${esc(p.ebay?.currency || '$')}"></div>
            </div>
            <input type="text" id="ebay-notes" placeholder="Supplier notes…" style="font-size:0.78rem;margin-top:0" value="${esc(p.ebay?.notes || '')}">
          </div>
          <div class="platform-section">
            <div class="platform-section-title"><span class="platform-dot dot-shopee"></span> Shopee</div>
            <div class="form-row">
              <div class="form-group"><label>Link</label><input type="url" id="shopee-url" placeholder="https://shopee.com/..." value="${esc(p.shopee?.url || '')}"></div>
              <div class="form-group" style="max-width:90px"><label>Price</label><input type="number" id="shopee-price" step="0.01" min="0" value="${p.shopee?.price || ''}"></div>
              <div class="form-group" style="max-width:70px"><label>Currency</label><input type="text" id="shopee-currency" maxlength="5" value="${esc(p.shopee?.currency || '$')}"></div>
            </div>
            <input type="text" id="shopee-notes" placeholder="Supplier notes…" style="font-size:0.78rem;margin-top:0" value="${esc(p.shopee?.notes || '')}">
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
    if (platform && ['amazon','lazada','aliexpress','ebay','shopee'].includes(platform)) {
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

  // Add spec field inline — capture current form state, re-open with new field visible
  document.getElementById('add-spec-field-btn').addEventListener('click', () => {
    openDefineSpecFieldModal(() => {
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
    item.updatedAt = Date.now();

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

    saveData(state.data); close(); renderAll();
  });
}

export function buildItemFromModal(existing) {
  const inputSpecs = {}, outputSpecs = {}, specs = {};
  document.querySelectorAll('.spec-input').forEach(input => {
    const section = input.dataset.section, fid = input.dataset.field, key = input.dataset.key;
    const val = input.value.trim();
    if (!val) return;
    const target = section === 'out' ? outputSpecs : section === 'gen' ? specs : inputSpecs;
    if (!target[fid]) target[fid] = {};
    target[fid][key] = key === 'text' ? val : parseFloat(val);
  });

  const linkedParts = [...document.querySelectorAll('input[name="linked"]:checked')].map(el => el.value);

  const pf = (id, fb = '') => document.getElementById(id)?.value.trim() || fb;
  return {
    quantity: parseInt(document.getElementById('item-qty')?.value) || 1,
    stock: parseInt(document.getElementById('item-stock')?.value) || 0,
    componentType: pf('item-type'),
    status: document.getElementById('item-status')?.value || 'needed',
    isSupply: !!(document.getElementById('item-is-supply')?.checked),
    imageUrl: pf('item-img'),
    inputSpecs, outputSpecs, specs,
    specsNotes: document.getElementById('item-notes')?.value.trim() || '',
    linkedParts,
    platforms: {
      amazon:     { url: pf('amazon-url'),     price: pf('amazon-price'),     currency: pf('amazon-currency', '$'),     notes: pf('amazon-notes') },
      lazada:     { url: pf('lazada-url'),     price: pf('lazada-price'),     currency: pf('lazada-currency', '$'),     notes: pf('lazada-notes') },
      aliexpress: { url: pf('aliexpress-url'), price: pf('aliexpress-price'), currency: pf('aliexpress-currency', '$'), notes: pf('aliexpress-notes') },
      ebay:       { url: pf('ebay-url'),       price: pf('ebay-price'),       currency: pf('ebay-currency', '$'),       notes: pf('ebay-notes') },
      shopee:     { url: pf('shopee-url'),     price: pf('shopee-price'),     currency: pf('shopee-currency', '$'),     notes: pf('shopee-notes') },
    }
  };
}

// ── Cross-BOM Compare ────────────────────────────────────────────────────────

export function openCompareBomModal() {
  if (state.data.boms.length < 2) {
    alert('You need at least 2 BOMs to compare. Create another BOM first.');
    return;
  }

  let selectedIds = new Set(state.activeBomId ? [state.activeBomId] : [state.data.boms[0].id]);

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
    const boms = [...selectedIds].map(id => state.data.boms.find(b => b.id === id)).filter(Boolean);
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

  const checkboxes = state.data.boms.map(b => `
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

export function calcBomTotalRaw(bom) {
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
// ── Bundles / Kits ────────────────────────────────────────────────────────────

export function openBundlesModal() {
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
        saveData(state.data);
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

export function openBundleEditModal(bom, idx, onSave, skipGlobalSave = false) {
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
    if (!skipGlobalSave) saveData(state.data);
    close();
    onSave();
  });
}

// ── Spec fields manager ───────────────────────────────────────────────────────

export function openSpecFieldsModal() {
  const renderList = () => state.data.specFields.map((f, i) => `
    <div class="spec-mgr-row">
      <span class="spec-mgr-name">${esc(f.name)}</span>
      <span class="spec-mgr-meta">${f.unit || '—'} · ${f.type}${f.directional ? ' · ⚡ in/out' : ''}</span>
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
            <div class="form-group" style="flex:none;align-self:flex-end;padding-bottom:2px">
              <label class="supply-checkbox-label"><input type="checkbox" id="new-field-directional"> ⚡ In/Out</label>
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
        state.data.specFields.splice(parseInt(btn.dataset.idx), 1);
        saveData(state.data);
        document.getElementById('spec-mgr-list').innerHTML = renderList();
        rebind();
      })
    );
  };
  rebind();

  document.getElementById('add-field-btn').addEventListener('click', () => {
    const name = document.getElementById('new-field-name').value.trim();
    if (!name) return alert('Name required');
    if (state.data.specFields.find(f => f.name.toLowerCase() === name.toLowerCase())) return alert('Field already exists');
    state.data.specFields.push({
      id: name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString(36),
      name,
      unit: document.getElementById('new-field-unit').value.trim(),
      type: document.getElementById('new-field-type').value,
      directional: !!(document.getElementById('new-field-directional')?.checked),
    });
    saveData(state.data);
    document.getElementById('new-field-name').value = '';
    document.getElementById('new-field-unit').value = '';
    document.getElementById('spec-mgr-list').innerHTML = renderList();
    rebind();
  });
}

export function openDefineSpecFieldModal(callback) {
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
            <div class="form-group" style="flex:none;align-self:flex-end;padding-bottom:2px">
              <label class="supply-checkbox-label"><input type="checkbox" id="inner-field-directional"> ⚡ In/Out</label>
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
    if (!state.data.specFields.find(f => f.name.toLowerCase() === name.toLowerCase())) {
      state.data.specFields.push({
        id: name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString(36),
        name,
        unit: document.getElementById('inner-field-unit').value.trim(),
        type: document.getElementById('inner-field-type').value,
        directional: !!(document.getElementById('inner-field-directional')?.checked),
      });
      saveData(state.data);
    }
    close();
    callback();
  });
}

export function openSettingsModal() {
  const html = `
    <div class="modal-overlay" id="settings-overlay">
      <div class="modal">
        <div class="modal-header">
          <h2>⚙ Settings & Data</h2>
          <button class="modal-close" id="settings-close">✕</button>
        </div>
        <div class="modal-body" style="display:flex; flex-direction:column; gap:16px;">
          
          <div class="autofill-section">
            <h3 style="font-size:0.9rem; margin-bottom:8px;">Backup / Restore (Full JSON)</h3>
            <p style="font-size:0.75rem; color:var(--text-muted); margin-bottom:8px;">
              Export your entire database (all BOMs, items, and settings) as a single JSON file.
            </p>
            <div style="display:flex; gap:8px;">
              <button class="header-btn primary" id="settings-export-json">↓ Export JSON</button>
              <button class="header-btn danger" id="settings-import-json">↑ Import JSON</button>
              <input type="file" id="settings-import-file" accept=".json" style="display:none">
            </div>
          </div>

          <div class="autofill-section">
            <h3 style="font-size:0.9rem; margin-bottom:8px;">Currency Override</h3>
            <p style="font-size:0.75rem; color:var(--text-muted); margin-bottom:8px;">
              Provide a manual exchange rate to USD if offline or if you prefer a specific rate.
            </p>
            <div style="display:flex; gap:8px; align-items:center;">
              <input type="text" id="settings-currency-code" placeholder="Code (e.g. PHP)" style="width:120px; padding:6px; border-radius:4px; border:1px solid var(--border); background:var(--surface2); color:var(--text)">
              <input type="number" id="settings-currency-rate" placeholder="Rate (vs USD)" style="width:120px; padding:6px; border-radius:4px; border:1px solid var(--border); background:var(--surface2); color:var(--text)">
              <button class="header-btn" id="settings-save-rate">Save Rate</button>
            </div>
          </div>

        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  
  const overlay = document.getElementById('settings-overlay');
  const close = () => overlay.remove();
  document.getElementById('settings-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });

  import('./../data.js').then(({ state, saveData }) => {
    document.getElementById('settings-export-json').addEventListener('click', () => {
      const json = JSON.stringify(state.data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bom_tracker_backup_${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    const fileInput = document.getElementById('settings-import-file');
    document.getElementById('settings-import-json').addEventListener('click', () => fileInput.click());
    
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (!parsed.boms || !Array.isArray(parsed.boms)) throw new Error('Invalid backup file');
          if (confirm('This will completely replace all your existing data. Are you sure?')) {
            state.data = parsed;
            saveData(state.data);
            alert('Data restored successfully!');
            location.reload();
          }
        } catch (err) {
          alert('Failed to parse JSON file.');
          console.error(err);
        }
      };
      reader.readAsText(file);
    });
  });

  import('./../currency.js').then(({ updateRatesStatus }) => {
    document.getElementById('settings-save-rate').addEventListener('click', () => {
      const code = document.getElementById('settings-currency-code').value.toUpperCase().trim();
      const rate = parseFloat(document.getElementById('settings-currency-rate').value);
      if (code && !isNaN(rate)) {
        try {
          let cache = JSON.parse(localStorage.getItem('bom-rates-v1')) || { rates: {}, fetchedAt: Date.now() };
          cache.rates[code] = rate;
          localStorage.setItem('bom-rates-v1', JSON.stringify(cache));
          alert(`Rate saved: 1 USD = ${rate} ${code}`);
          location.reload(); // Quickest way to apply custom rate across all UI
        } catch(e) {}
      }
    });
  });
}
