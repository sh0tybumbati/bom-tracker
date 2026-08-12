

// ── Storage ───────────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'bom-tracker-data';

export const DEFAULT_SPEC_FIELDS = [
  { id: 'voltage',     name: 'Voltage',       unit: 'V',   type: 'range', directional: true  },
  { id: 'current',     name: 'Current',       unit: 'A',   type: 'range', directional: true  },
  { id: 'wattage',     name: 'Wattage',       unit: 'W',   type: 'value', directional: true  },
  { id: 'capacity',    name: 'Capacity',      unit: 'Ah',  type: 'value', directional: true  },
  { id: 'weight',      name: 'Weight',        unit: 'g',   type: 'value', directional: false },
  { id: 'frequency',   name: 'Frequency',     unit: 'Hz',  type: 'range', directional: false },
  { id: 'temperature', name: 'Temp. Range',   unit: '°C',  type: 'range', directional: false },
  { id: 'resistance',  name: 'Resistance',    unit: 'Ω',   type: 'range', directional: false },
  { id: 'dimensions',  name: 'Dimensions',    unit: 'mm',  type: 'text',  directional: false },
  { id: 'connector',   name: 'Connector',     unit: '',    type: 'text',  directional: false },
  { id: 'protocol',    name: 'Protocol',      unit: '',    type: 'text',  directional: false },
];

export async function loadDataAsync() {
  try {
    let raw = null;
    if (window.idbKeyval) {
      raw = await window.idbKeyval.get(STORAGE_KEY);
    }
    if (!raw) {
      const ls = localStorage.getItem(STORAGE_KEY);
      if (ls) {
        raw = JSON.parse(ls);
        // migrate to IDB
        if (window.idbKeyval) await window.idbKeyval.set(STORAGE_KEY, raw);
      }
    }
    const d = raw || {};
    if (!d.boms) d.boms = [];
    if (!d.specFields) d.specFields = [...DEFAULT_SPEC_FIELDS];
    
    // Migrate: add directional flag to existing spec fields that lack it
    const DIRECTIONAL_IDS = new Set(['voltage', 'current', 'wattage', 'capacity']);
    const DIRECTIONAL_UNITS = new Set(['v', 'a', 'w', 'ah']);
    d.specFields.forEach(f => {
      if (f.directional === undefined)
        f.directional = DIRECTIONAL_IDS.has(f.id) || DIRECTIONAL_UNITS.has((f.unit || '').toLowerCase().trim());
    });
    // Migrate: if item.specs is a plain string, move to specsNotes
    d.boms.forEach(bom => {
      if (!bom.bundles) bom.bundles = [];
      if (!bom.proposals) bom.proposals = [];
      bom.bundles.forEach(b => { if (!b.id) b.id = uuid(); });
      bom.items.forEach(item => {
        if (typeof item.specs === 'string') { item.specsNotes = item.specs; item.specs = {}; }
        if (!item.specs) item.specs = {};
        if (!item.linkedParts) item.linkedParts = [];
        if (item.stock === undefined) item.stock = 0;
        if (!item.platforms) item.platforms = {};
        ['amazon','lazada','aliexpress','ebay','shopee'].forEach(p => {
          if (!item.platforms[p]) item.platforms[p] = {};
        });
        if (item.isSupply === undefined) item.isSupply = false;
        // Migrate legacy item.specs → inputSpecs / outputSpecs
        if (!item.inputSpecs)  item.inputSpecs  = item.isSupply ? {} : { ...item.specs };
        if (!item.outputSpecs) item.outputSpecs = item.isSupply ? { ...item.specs } : {};
      });
    });
    state.data = d;
  } catch (e) {
    console.error('Failed to load data', e);
    state.data = { boms: [], specFields: [...DEFAULT_SPEC_FIELDS] };
  }
}

export function saveData(data) {
  if (window.idbKeyval) {
    window.idbKeyval.set(STORAGE_KEY, data).catch(console.error);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
}

export function uuid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// ── State ─────────────────────────────────────────────────────────────────────

export const state = {
  data: { boms: [], specFields: [] }, // Will be loaded by loadDataAsync
  activeBomId: null,
  filterState: { fieldId: '', value: '', value2: '' },
  searchQuery: '',
  viewMode: localStorage.getItem('bom-view-mode') || 'list'
};








export const STATUS_LABEL = { needed: 'Need to order', ordered: 'Ordered', received: 'In stock' };
export const STATUS_ORDER = { received: 0, ordered: 1, needed: 2 };

export function getActiveBom() { return state.data.boms.find(b => b.id === state.activeBomId) || null; }

export function getItem(itemId) {
  for (const bom of state.data.boms) {
    const item = bom.items.find(i => i.id === itemId);
    if (item) return item;
  }
  return null;
}
