import { codeOfSym, getDisplayCurrency, priceInDisplay, symOf, toDisplay } from './currency.js';
import { STATUS_LABEL, getActiveBom, saveData, state, uuid } from './data.js';
import { formatSpec } from './compat.js';
import { renderItems } from './ui/items.js';
import { renderAll } from './ui/render.js';

// ── Delete ────────────────────────────────────────────────────────────────────

export function deleteItem(itemId) {
  const bom = getActiveBom();
  const item = bom.items.find(i => i.id === itemId);
  if (!item) return;
  const idx = bom.items.indexOf(item);
  // Snapshot which other items linked to this one
  const linkedFrom = bom.items
    .filter(i => (i.linkedParts || []).includes(itemId))
    .map(i => i.id);
  bom.items.splice(idx, 1);
  bom.items.forEach(i => { i.linkedParts = (i.linkedParts || []).filter(id => id !== itemId); });
  saveData(state.data); renderAll();
  showToastWithUndo(`Deleted "${item.name}"`, () => {
    const cur = getActiveBom();
    if (!cur) return;
    cur.items.splice(idx, 0, item);
    linkedFrom.forEach(oid => {
      const other = cur.items.find(i => i.id === oid);
      if (other && !(other.linkedParts || []).includes(itemId))
        (other.linkedParts = other.linkedParts || []).push(itemId);
    });
    saveData(state.data); renderAll();
  });
}

export function deleteBom() {
  const bom = getActiveBom();
  if (!confirm(`Delete "${bom.name}"?`)) return;
  state.data.boms = state.data.boms.filter(b => b.id !== state.activeBomId);
  state.activeBomId = state.data.boms[0]?.id || null;
  saveData(state.data); renderAll();
}

// ── Import CSV ────────────────────────────────────────────────────────────────

export function parseCSVLine(text, pos) {
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

export function parseCSV(text) {
  const rows = [];
  let pos = 0;
  while (pos < text.length) {
    const { fields, next } = parseCSVLine(text, pos);
    pos = next;
    if (fields.length && !(fields.length === 1 && fields[0] === '')) rows.push(fields);
  }
  return rows;
}

export function importFromCSV(rows) {
  // Find ITEMS section header row
  let headerIdx = rows.findIndex(r => r[0] === 'ITEMS');
  headerIdx = headerIdx >= 0 ? headerIdx + 1 : (rows[0]?.[0] === 'Name' ? 0 : -1);
  if (headerIdx < 0) return null;

  const header = rows[headerIdx];
  const ci = name => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const iName    = ci('name');
  const iQty     = ci('qty');
  const iStock   = ci('stock');
  const iIsSupply = ci('is supply');
  const iStatus  = ci('status');
  const iType    = ci('component type') >= 0 ? ci('component type') : ci('componenttype');
  const iNotes   = ci('notes');
  const iImg     = ci('image url');
  const iAmazonUrl = ci('amazon url'), iAmazonPrice = ci('amazon price'), iAmazonCur = ci('amazon currency');
  const iLazUrl    = ci('lazada url'),  iLazPrice    = ci('lazada price'),  iLazCur    = ci('lazada currency');
  const iAliUrl    = ci('aliexpress url'), iAliPrice = ci('aliexpress price'), iAliCur = ci('aliexpress currency');
  const iEbayUrl   = ci('ebay url'),   iEbayPrice   = ci('ebay price'),   iEbayCur   = ci('ebay currency');
  const iShopeeUrl = ci('shopee url'), iShopeePrice = ci('shopee price'), iShopeeCur = ci('shopee currency');
  const iUpdatedAt = ci('updated at');
  if (iName < 0) return null;

  // Detect spec field columns — directional: "Name in (unit)" / "Name out (unit)"; non-directional: "Name (unit)"
  const specColMap = [];
  state.data.specFields.forEach(f => {
    const nameLo = f.name.toLowerCase();
    if (f.directional) {
      const inIdx  = header.findIndex(h => h.toLowerCase().startsWith(nameLo + ' in'));
      const outIdx = header.findIndex(h => h.toLowerCase().startsWith(nameLo + ' out'));
      const legIdx = (inIdx < 0 && outIdx < 0)
        ? header.findIndex(h => h.toLowerCase().startsWith(nameLo)) : -1;
      specColMap.push({ field: f, inIdx, outIdx, legIdx, isDirectional: true });
    } else {
      const genIdx = header.findIndex(h => h.toLowerCase().startsWith(nameLo));
      specColMap.push({ field: f, inIdx: -1, outIdx: -1, legIdx: genIdx, isDirectional: false });
    }
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

    const parseSpecVal = (raw, field) => {
      if (!raw || raw === '—') return null;
      if (field.type === 'text') return { text: raw };
      if (field.type === 'value') { const v = parseFloat(raw); return isNaN(v) ? null : { value: v }; }
      if (field.type === 'range') {
        const m = raw.replace(/[^\d.\-–]/g, '').match(/^([\d.]+)[–-]([\d.]+)$/);
        if (m) return { min: parseFloat(m[1]), max: parseFloat(m[2]) };
        const v = parseFloat(raw); return isNaN(v) ? null : { value: v };
      }
      return null;
    };
    const inputSpecs = {}, outputSpecs = {}, specs = {}, legacySpecs = {};
    const isSupplyCsv = iIsSupply >= 0 ? /^yes$/i.test(r[iIsSupply]?.trim()) : false;
    specColMap.forEach(({ field, inIdx, outIdx, legIdx, isDirectional }) => {
      if (inIdx  >= 0) { const v = parseSpecVal(r[inIdx]?.trim(),  field); if (v) inputSpecs[field.id]  = v; }
      if (outIdx >= 0) { const v = parseSpecVal(r[outIdx]?.trim(), field); if (v) outputSpecs[field.id] = v; }
      if (legIdx >= 0) {
        const v = parseSpecVal(r[legIdx]?.trim(), field);
        if (v) {
          if (isDirectional) legacySpecs[field.id] = v; // directional legacy → distribute below
          else               specs[field.id] = v;        // non-directional → flat specs
        }
      }
    });
    // If only legacy directional columns exist, distribute by isSupply flag
    if (Object.keys(legacySpecs).length) {
      if (isSupplyCsv) Object.assign(outputSpecs, legacySpecs);
      else             Object.assign(inputSpecs, legacySpecs);
    }

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
      stock: iStock >= 0 ? parseInt(r[iStock]) || 0 : 0,
      isSupply: isSupplyCsv,
      status,
      specsNotes: iNotes >= 0 ? r[iNotes]?.trim() || '' : '',
      imageUrl:   iImg   >= 0 ? r[iImg]?.trim()   || '' : '',
      specs, inputSpecs, outputSpecs,
      linkedParts: [],
      updatedAt: iUpdatedAt >= 0 && r[iUpdatedAt] ? (new Date(r[iUpdatedAt]).getTime() || null) : null,
      platforms: {
        amazon:     { url: r[iAmazonUrl]?.trim()  || '', price: r[iAmazonPrice]?.trim()  || '', currency: r[iAmazonCur]?.trim()  || '$' },
        lazada:     { url: r[iLazUrl]?.trim()     || '', price: r[iLazPrice]?.trim()     || '', currency: r[iLazCur]?.trim()     || '$' },
        aliexpress: { url: r[iAliUrl]?.trim()     || '', price: r[iAliPrice]?.trim()     || '', currency: r[iAliCur]?.trim()     || '$' },
        ebay:       { url: r[iEbayUrl]?.trim()    || '', price: r[iEbayPrice]?.trim()    || '', currency: r[iEbayCur]?.trim()    || '$' },
        shopee:     { url: r[iShopeeUrl]?.trim()  || '', price: r[iShopeePrice]?.trim()  || '', currency: r[iShopeeCur]?.trim()  || '$' },
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
export function importItemsFromCSV(rows) { return importFromCSV(rows); }

export function triggerCSVImport() {
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

export function openCSVImportModal(items, bundles, filename) {
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
              ${state.data.boms.filter(b => b.id !== bom?.id).map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}
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
      state.data.boms.push(targetBom);
      state.activeBomId = targetBom.id;
    } else {
      targetBom = state.data.boms.find(b => b.id === targetVal);
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

    saveData(state.data);
    close();
    renderAll();
    const bundleMsg = bundlesAdded ? `, ${bundlesAdded} bundle(s)` : '';
    showToast(`Imported ${added} item(s)${bundleMsg}${skipped ? `, skipped ${skipped} duplicate(s)` : ''}`);
  });
}

// ── Export CSV ────────────────────────────────────────────────────────────────

export function exportCSV() {
  const bom = getActiveBom();
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const row = cols => cols.map(q).join(',');
  const sections = [];

  // ── Items ──
  const csvDirFields = state.data.specFields.filter(f => f.directional);
  const csvGenFields = state.data.specFields.filter(f => !f.directional);
  const specInHeaders  = csvDirFields.map(f => `${f.name} in (${f.unit || f.type})`);
  const specOutHeaders = csvDirFields.map(f => `${f.name} out (${f.unit || f.type})`);
  const specGenHeaders = csvGenFields.map(f => `${f.name} (${f.unit || f.type})`);
  sections.push(row(['ITEMS']));
  sections.push(row(['Name', 'Component Type', 'Qty', 'Stock', 'Is Supply', 'Status', 'Notes', 'Image URL',
    ...specInHeaders, ...specOutHeaders, ...specGenHeaders,
    'Amazon URL', 'Amazon Price', 'Amazon Currency',
    'Lazada URL', 'Lazada Price', 'Lazada Currency',
    'AliExpress URL', 'AliExpress Price', 'AliExpress Currency',
    'eBay URL', 'eBay Price', 'eBay Currency',
    'Shopee URL', 'Shopee Price', 'Shopee Currency',
    'Best Price', 'Linked Parts', 'Updated At']));

  for (const item of bom.items) {
    const prices = getPrices(item);
    const cheapest = prices.length ? prices.reduce((a, b) => a.price < b.price ? a : b) : null;
    const p = item.platforms || {};
    const specInValues  = csvDirFields.map(f => formatSpec((item.inputSpecs || item.specs)?.[f.id], f));
    const specOutValues = csvDirFields.map(f => formatSpec(item.outputSpecs?.[f.id], f));
    const specGenValues = csvGenFields.map(f => formatSpec((item.specs || item.inputSpecs)?.[f.id], f));
    const linkedNames = (item.linkedParts || []).map(id => bom.items.find(i => i.id === id)?.name || '').filter(Boolean).join('; ');
    sections.push(row([
      item.name, item.componentType || '', item.quantity || 1, item.stock || 0,
      item.isSupply ? 'yes' : '',
      STATUS_LABEL[item.status || 'needed'] || item.status || '',
      item.specsNotes || '', item.imageUrl || '',
      ...specInValues, ...specOutValues, ...specGenValues,
      p.amazon?.url || '', p.amazon?.price || '', p.amazon?.currency || '',
      p.lazada?.url || '', p.lazada?.price || '', p.lazada?.currency || '',
      p.aliexpress?.url || '', p.aliexpress?.price || '', p.aliexpress?.currency || '',
      p.ebay?.url || '', p.ebay?.price || '', p.ebay?.currency || '',
      p.shopee?.url || '', p.shopee?.price || '', p.shopee?.currency || '',
      cheapest ? `${cheapest.currency}${cheapest.price}` : '',
      linkedNames,
      item.updatedAt ? new Date(item.updatedAt).toISOString() : '',
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

export function downloadText(text, filename, type) {
  const a = document.createElement('a');
  a.href = `data:${type};charset=utf-8,` + encodeURIComponent(text);
  a.download = filename;
  a.click();
}

// ── Calc ──────────────────────────────────────────────────────────────────────

export function getPrices(item) {
  return ['amazon', 'lazada', 'aliexpress', 'ebay', 'shopee']
    .map(p => { const d = item.platforms?.[p]; return d?.price && d?.url ? { platform: p, price: parseFloat(d.price), currency: d.currency || '$' } : null; })
    .filter(Boolean);
}

export function formatRelTime(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(ts).toLocaleDateString();
}

export function duplicateItem(itemId) {
  const bom = getActiveBom();
  const item = bom.items.find(i => i.id === itemId);
  if (!item) return;
  const copy = JSON.parse(JSON.stringify(item));
  copy.id = uuid();
  copy.name = item.name + ' (copy)';
  copy.linkedParts = [];
  copy.updatedAt = Date.now();
  bom.items.splice(bom.items.indexOf(item) + 1, 0, copy);
  saveData(state.data);
  renderItems();
  showToast(`Duplicated "${item.name}"`);
}

export function coveredByBundle(itemId, bom) {
  return (bom.bundles || []).find(b => b.coversItemIds?.includes(itemId)) || null;
}

export function formatBundlePrice(bundle) {
  if (!bundle?.price) return '';
  return priceInDisplay(bundle.price, bundle.currency || '$');
}

export function calcBomTotal(bom) {
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

export function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Share / Import ────────────────────────────────────────────────────────────

export function shareBom() {
  const bom = getActiveBom();
  if (!bom) return;
  try {
    const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(bom));
    const url = `${location.origin}${location.pathname}#share=${compressed}`;
    navigator.clipboard.writeText(url).then(() => {
      showToast('Share link copied!');
    }).catch(() => {
      prompt('Copy this link:', url);
    });
    openQRModal(url);
  } catch (e) {
    alert('Failed to generate share link.');
  }
}

export function openQRModal(url) {
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
  const html = `
    <div class="modal-overlay" id="modal-overlay-qr">
      <div class="modal" style="max-width:300px;text-align:center">
        <div class="modal-header">
          <h2>📲 Share QR Code</h2>
          <button class="modal-close" id="qr-close">✕</button>
        </div>
        <div class="modal-body">
          <img class="qr-modal-img" src="${esc(qrSrc)}" width="200" height="200" alt="QR Code">
          <p style="font-size:0.75rem;color:var(--text-muted);margin-top:8px">Scan to open this BOM on another device.</p>
          <p style="font-size:0.7rem;color:var(--text-muted);margin-top:4px">Link also copied to clipboard.</p>
        </div>
        <div class="modal-footer" style="justify-content:center">
          <button class="header-btn primary" id="qr-done">Done</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const overlay = document.getElementById('modal-overlay-qr');
  const close = () => overlay.remove();
  document.getElementById('qr-close').addEventListener('click', close);
  document.getElementById('qr-done').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

export function checkShareParam() {
  const hash = location.hash;
  if (!hash.startsWith('#share=')) return;
  const compressed = hash.slice(7);
  try {
    const bom = JSON.parse(LZString.decompressFromEncodedURIComponent(compressed));
    if (!bom?.name) return;

    // Check if already imported
    const exists = state.data.boms.find(b => b.name === bom.name);
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
    state.data.boms.push(bom);
    state.activeBomId = bom.id;
    saveData(state.data);
    history.replaceState(null, '', location.pathname);
    renderAll();
    showToast(`Imported "${bom.name}"`);
  } catch (e) {
    console.error('Failed to import shared BOM', e);
    history.replaceState(null, '', location.pathname);
  }
}

export function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('toast-show'), 10);
  setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.remove(), 300); }, 3000);
}

export function showToastWithUndo(msg, undoFn) {
  const t = document.createElement('div');
  t.className = 'toast toast-undo';
  t.innerHTML = `${esc(msg)} <button class="toast-undo-btn">Undo</button>`;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('toast-show'), 10);
  let undone = false;
  const timer = setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.remove(), 300); }, 5000);
  t.querySelector('.toast-undo-btn').addEventListener('click', () => {
    if (undone) return; undone = true;
    clearTimeout(timer);
    undoFn();
    t.classList.remove('toast-show'); setTimeout(() => t.remove(), 300);
    showToast('Restored!');
  });
}
