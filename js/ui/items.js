import { codeOfSym, priceInDisplay, toDisplay } from '../currency.js';
import { STATUS_LABEL, STATUS_ORDER, getActiveBom, saveData, state } from '../data.js';
import { COMPAT_COLOR, COMPAT_ICON, COMPAT_LABEL, checkItemCompat, formatSpec, hasSpecValue, overallStatus } from '../compat.js';
import { openCopyItemModal, openItemModal } from './modals.js';
import { updateTopbarBomName } from './render.js';
import { coveredByBundle, deleteItem, duplicateItem, esc, formatBundlePrice, formatRelTime, getPrices } from '../utils.js';
import { renderGraphView } from './graph.js';

// ── Filter ────────────────────────────────────────────────────────────────────

export function itemMatchesFilter(item) {
  if (state.searchQuery && !item.name.toLowerCase().includes(state.searchQuery.toLowerCase())) return false;
  const { fieldId, value, value2 } = state.filterState;
  if (!fieldId || value === '') return true;
  const field = state.data.specFields.find(f => f.id === fieldId);
  if (!field) return true;
  const spec = item.inputSpecs?.[fieldId] || item.outputSpecs?.[fieldId] || item.specs?.[fieldId];
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
// ── Items ─────────────────────────────────────────────────────────────────────

export function renderItems() {
  const bom = getActiveBom();
  const area = document.getElementById('items-area');
  if (!area || !bom) return;

  let filtered = bom.items.filter(itemMatchesFilter);
  const sort = state.filterState.sort || 'default';
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

  area.classList.toggle('tile-view', state.viewMode === 'tile');

  if (state.viewMode === 'graph') {
    renderGraphView(bom);
    return;
  }

  if (sort === 'status' && state.viewMode === 'list') {
    const groupOrder = ['received', 'ordered', 'needed'];
    const groupLabels = { received: 'In Stock', ordered: 'Ordered', needed: 'Need to Order' };
    area.innerHTML = groupOrder.map(s => {
      const gi = filtered.filter(i => (i.status || 'needed') === s);
      if (!gi.length) return '';
      return `<div class="status-group-header group-${s}">${groupLabels[s]} (${gi.length})</div>` + gi.map(item => renderItemCard(item, bom)).join('');
    }).join('');
  } else {
    area.innerHTML = state.viewMode === 'tile'
      ? filtered.map(item => renderItemTile(item, bom)).join('')
      : filtered.map(item => renderItemCard(item, bom)).join('');
  }

  area.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = bom.items.find(i => i.id === btn.dataset.id);
      if (!item) return;
      const delta = parseInt(btn.dataset.delta);
      item.quantity = Math.max(1, (item.quantity || 1) + delta);
      saveData(state.data);
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

  area.querySelectorAll('.item-dup-btn').forEach(btn =>
    btn.addEventListener('click', () => duplicateItem(btn.dataset.id))
  );

  area.querySelectorAll('.item-del-btn').forEach(btn =>
    btn.addEventListener('click', () => deleteItem(btn.dataset.id))
  );

  // Drag-to-reorder (list view)
  if (state.viewMode === 'list') {
    let dragSrcId = null;
    area.querySelectorAll('.item-card').forEach(card => {
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', e => {
        dragSrcId = card.dataset.itemId;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        area.querySelectorAll('.item-card').forEach(c => c.classList.remove('drag-over'));
      });
      card.addEventListener('dragover', e => {
        e.preventDefault();
        if (card.dataset.itemId !== dragSrcId) card.classList.add('drag-over');
      });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', e => {
        e.preventDefault();
        card.classList.remove('drag-over');
        const tgtId = card.dataset.itemId;
        if (!dragSrcId || dragSrcId === tgtId) return;
        const srcIdx = bom.items.findIndex(i => i.id === dragSrcId);
        const tgtIdx = bom.items.findIndex(i => i.id === tgtId);
        if (srcIdx < 0 || tgtIdx < 0) return;
        const [moved] = bom.items.splice(srcIdx, 1);
        bom.items.splice(tgtIdx, 0, moved);
        saveData(state.data); renderItems();
      });
    });
  }

  // Swipe-to-delete on list cards
  if (state.viewMode === 'list') {
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

export function renderItemCard(item, bom) {
  const prices = getPrices(item);
  const cheapest = prices.length ? prices.reduce((a, b) => a.price < b.price ? a : b) : null;
  const status = item.status || 'needed';
  const bundle = coveredByBundle(item.id, bom);

  // Price spread warning (>50% spread in display currency)
  let priceWarnHtml = '';
  if (prices.length >= 2) {
    const vals = prices.map(p => { const c = codeOfSym(p.currency); const cv = c ? toDisplay(p.price, c) : null; return cv ? cv.amount : p.price; });
    const lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo > 0 && (hi - lo) / lo > 0.5) priceWarnHtml = `<span class="price-spread-warn" title="Prices vary by over 50%">⚠ price spread</span>`;
  }

  const imgHtml = item.imageUrl
    ? `<div class="item-img"><img src="${esc(item.imageUrl)}" alt="" onerror="this.parentElement.innerHTML='📦'"></div>`
    : `<div class="item-img">📦</div>`;

  const platformBtns = ['amazon', 'lazada', 'aliexpress', 'ebay', 'shopee'].map(p => {
    const d = item.platforms?.[p];
    if (!d?.url) return '';
    const isCheap = cheapest?.platform === p ? ' cheapest' : '';
    const label = { amazon: '🟠 Amazon', lazada: '🔵 Lazada', aliexpress: '🔴 AliExpress', ebay: '🔷 eBay', shopee: '🟧 Shopee' }[p];
    const priceStr = d.price ? ` · ${priceInDisplay(d.price, d.currency || '$')}` : '';
    const noteStr = d.notes ? ` <small style="opacity:.5">${esc(d.notes)}</small>` : '';
    return `<a class="platform-btn ${p}${isCheap}" href="${esc(d.url)}" target="_blank" rel="noopener">${label}${priceStr}${noteStr}</a>`;
  }).join('');

  const makeChips = (specs, dir) => state.data.specFields
    .filter(f => hasSpecValue(specs?.[f.id], f))
    .map(f => `<span class="spec-chip spec-chip-${dir||'legacy'}"><span class="spec-dir-label">${dir ? dir+' ' : ''}</span>${esc(f.name)}: <strong>${esc(formatSpec(specs[f.id], f))}</strong></span>`)
    .join('');
  const specChips = makeChips(item.inputSpecs, 'in') + makeChips(item.outputSpecs, 'out') + makeChips(item.specs, '');

  const linkedHtml = (item.linkedParts || []).map(linkedId => {
    const linkedItem = bom.items.find(i => i.id === linkedId);
    if (!linkedItem) return '';
    const results = checkItemCompat(item, linkedItem);
    const cs = overallStatus(results);
    const details = results.map(r => `${r.field.name}: ${COMPAT_ICON[r.status]}`).join(' · ') || 'No shared specs';
    const hasDirectional = results.some(r => r.dir === 'a→b' || r.dir === 'b→a');
    const supplyVerb = { ok: 'Powers', warn: 'Marginal power', mismatch: 'Cannot power', unknown: 'Linked' };
    const chipLabel = hasDirectional ? `⚡ ${supplyVerb[cs]}` : COMPAT_LABEL[cs];
    return `<div class="compat-chip" style="border-color:${COMPAT_COLOR[cs]}22;color:${COMPAT_COLOR[cs]}" title="${esc(details)}">
      ${COMPAT_ICON[cs]} ${esc(linkedItem.name)} <span style="font-size:0.65rem;opacity:0.7">${chipLabel}${details !== 'No shared specs' ? ' · ' + esc(details) : ''}</span>
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

  const statusBadge = `<span class="status-badge status-${status}">${STATUS_LABEL[status]}</span>`;
  const bundlePriceHtml = bundle ? formatBundlePrice(bundle) : '';
  const bundleBadge = bundle ? `<span class="bundle-badge">📦 ${esc(bundle.name)}${bundlePriceHtml ? ` · ${bundlePriceHtml}` : ''}</span>` : '';
  const typeBadge = item.componentType ? `<span class="type-badge">${esc(item.componentType)}</span>` : '';
  const supplyBadge = item.isSupply ? `<span class="supply-badge">⚡ Supply</span>` : '';
  const unpricedBadge = !prices.length && !bundle ? `<span class="unpriced-badge">⚠ no price</span>` : '';
  const stockBadge = item.stock > 0 ? `<span class="stock-badge">Stock: ${item.stock}</span>` : '';
  const extraBadges = [supplyBadge, unpricedBadge, stockBadge, priceWarnHtml].filter(Boolean).join('');
  const updatedHtml = item.updatedAt ? `<div style="font-size:0.6rem;color:var(--text-muted);margin-top:4px">Updated ${formatRelTime(item.updatedAt)}</div>` : '';

  return `
    <div class="item-card status-${status}" data-item-id="${item.id}">
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
        ${extraBadges ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">${extraBadges}</div>` : ''}
        ${specChips ? `<div class="spec-chips">${specChips}</div>` : ''}
        ${item.specsNotes ? `<div class="item-specs">${esc(item.specsNotes)}</div>` : ''}
        ${bundleBadge ? `<div style="margin-bottom:6px">${bundleBadge}</div>` : `<div class="item-links">${platformBtns || '<span style="font-size:0.73rem;color:var(--text-muted)">No links added</span>'}</div>`}
        ${linkedHtml ? `<div class="compat-row">${linkedHtml}</div>` : ''}
        ${updatedHtml}
      </div>
      <div class="item-actions">
        ${bestPriceHtml}
        <div class="qty-control">
          <button class="qty-btn" data-id="${item.id}" data-delta="-1">−</button>
          <span class="qty-val">${item.quantity || 1}</span>
          <button class="qty-btn" data-id="${item.id}" data-delta="1">+</button>
        </div>
        <button class="item-edit-btn" data-id="${item.id}">Edit</button>
        <button class="item-dup-btn" data-id="${item.id}" title="Duplicate">⊕</button>
        <button class="item-copy-btn" data-id="${item.id}" title="Copy to BOM">⎘</button>
        <button class="item-del-btn" data-id="${item.id}">Del</button>
      </div>
    </div>`;
}

export function renderItemTile(item, bom) {
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
  const unpricedTile = !getPrices(item).length && !bundle ? `<span class="unpriced-badge">⚠</span>` : '';
  const supplyTile = item.isSupply ? `<span class="supply-badge">⚡</span>` : '';

  return `
    <div class="item-tile status-${status}" data-item-id="${item.id}">
      <div class="item-tile-rect">
        <div class="item-tile-top-row">
          <div class="item-tile-img">${imgContent}</div>
          <div class="item-tile-actions">
            <button class="item-tile-btn edit item-edit-btn" data-id="${item.id}" title="Edit">✏</button>
            <button class="item-tile-btn item-dup-btn" data-id="${item.id}" title="Duplicate">⊕</button>
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
          ${supplyTile}
          ${typeMeta}
          ${priceHtml}
          ${unpricedTile}
          <span class="status-badge status-${status}" style="font-size:0.58rem;padding:1px 6px">${STATUS_LABEL[status]}</span>
        </div>
      </div>
    </div>`;
}
