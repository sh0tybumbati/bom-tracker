import { saveData } from '../data.js';
import { checkItemCompat, overallStatus } from '../compat.js';
import { esc } from '../utils.js';

// ── Graph View ────────────────────────────────────────────────────────────────

export const GRAPH_NODE_W = 110, GRAPH_NODE_H = 110;

export function renderGraphView(bom) {
  const area = document.getElementById('items-area');
  area.classList.remove('tile-view');

  // Assign default grid positions for items that don't have one yet
  const COLS = Math.max(1, Math.ceil(Math.sqrt(bom.items.length)));
  const SPACING_X = 160, SPACING_Y = 160;
  bom.items.forEach((item, i) => {
    if (!item.graphPos) {
      item.graphPos = {
        x: (i % COLS) * SPACING_X + 40,
        y: Math.floor(i / COLS) * SPACING_Y + 40,
      };
    }
  });
  if (!bom.graphPan) bom.graphPan = { x: 20, y: 20 };

  const nodesHtml = bom.items.map(item => {
    const s = item.status || 'needed';
    const imgHtml = item.imageUrl
      ? `<img src="${esc(item.imageUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : `<span class="graph-node-emoji">📦</span>`;
    return `<div class="graph-node graph-status-${s}" data-node-id="${item.id}"
        style="left:${item.graphPos.x}px;top:${item.graphPos.y}px;touch-action:none">
      <div class="graph-node-img">${imgHtml}</div>
      <div class="graph-node-name">${esc(item.name)}</div>
      ${item.isSupply ? `<span class="graph-node-badge">⚡</span>` : ''}
    </div>`;
  }).join('');

  area.innerHTML = `
    <div id="graph-view">
      <div id="graph-world" style="transform:translate(${bom.graphPan.x}px,${bom.graphPan.y}px)">
        <svg id="graph-lines" style="position:absolute;top:0;left:0;pointer-events:none;overflow:visible"></svg>
        ${nodesHtml}
      </div>
    </div>`;

  drawGraphLines(bom);
  setupGraphInteractions(bom);
}

export function drawGraphLines(bom) {
  const svg = document.getElementById('graph-lines');
  if (!svg) return;
  const hw = GRAPH_NODE_W / 2, hh = GRAPH_NODE_H / 2;
  const drawn = new Set();
  let svgContent = '';

  bom.items.forEach(item => {
    (item.linkedParts || []).forEach(linkedId => {
      const key = [item.id, linkedId].sort().join('|');
      if (drawn.has(key)) return;
      drawn.add(key);
      const a = item.graphPos;
      const bItem = bom.items.find(i => i.id === linkedId);
      if (!a || !bItem?.graphPos) return;
      const b = bItem.graphPos;
      const results = checkItemCompat(item, bItem);
      const cs = overallStatus(results);
      const color = cs === 'ok' ? '#4ade80' : cs === 'warn' ? '#facc15' : cs === 'mismatch' ? '#f87171' : '#555';
      const dash = cs === 'unknown' ? 'stroke-dasharray="7 4"' : '';
      svgContent += `<line x1="${a.x + hw}" y1="${a.y + hh}" x2="${b.x + hw}" y2="${b.y + hh}"
        stroke="${color}" stroke-width="2.5" stroke-linecap="round" opacity="0.85" ${dash}/>`;
    });
  });

  svg.innerHTML = svgContent;
}

export function setupGraphInteractions(bom) {
  const view = document.getElementById('graph-view');
  const world = document.getElementById('graph-world');
  if (!view || !world) return;

  let selected = new Set();
  let dragState = null;  // { startX, startY, startPositions }
  let panState  = null;  // { startX, startY, startPan }

  function applySelectionStyle() {
    world.querySelectorAll('.graph-node').forEach(el =>
      el.classList.toggle('graph-selected', selected.has(el.dataset.nodeId))
    );
  }

  view.addEventListener('pointerdown', e => {
    const node = e.target.closest('.graph-node');

    if (node) {
      const id = node.dataset.nodeId;
      if (e.shiftKey) {
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
      } else {
        if (!selected.has(id)) { selected.clear(); selected.add(id); }
      }
      applySelectionStyle();

      // Start drag — record starting positions of all selected nodes
      const startPositions = {};
      selected.forEach(sid => {
        const item = bom.items.find(i => i.id === sid);
        if (item?.graphPos) startPositions[sid] = { ...item.graphPos };
      });
      dragState = { startX: e.clientX, startY: e.clientY, startPositions };
      view.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else {
      // Start pan
      selected.clear();
      applySelectionStyle();
      panState = { startX: e.clientX, startY: e.clientY, startPan: { ...bom.graphPan } };
      view.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });

  view.addEventListener('pointermove', e => {
    if (dragState) {
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      selected.forEach(sid => {
        const item = bom.items.find(i => i.id === sid);
        const start = dragState.startPositions[sid];
        if (!item || !start) return;
        item.graphPos = { x: Math.max(0, start.x + dx), y: Math.max(0, start.y + dy) };
        const el = world.querySelector(`.graph-node[data-node-id="${sid}"]`);
        if (el) { el.style.left = item.graphPos.x + 'px'; el.style.top = item.graphPos.y + 'px'; }
      });
      drawGraphLines(bom);
    } else if (panState) {
      bom.graphPan = {
        x: panState.startPan.x + (e.clientX - panState.startX),
        y: panState.startPan.y + (e.clientY - panState.startY),
      };
      world.style.transform = `translate(${bom.graphPan.x}px,${bom.graphPan.y}px)`;
    }
  });

  view.addEventListener('pointerup', () => {
    if (dragState || panState) saveData(state.data);
    dragState = null;
    panState  = null;
  });

  view.addEventListener('pointercancel', () => { dragState = null; panState = null; });
}
