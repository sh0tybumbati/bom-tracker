import { state } from './data.js';

// ── Spec helpers ──────────────────────────────────────────────────────────────

export function hasSpecValue(spec, field) {
  if (!spec) return false;
  if (field.type === 'text')  return !!(spec.text?.trim());
  if (field.type === 'value') return spec.value !== undefined && spec.value !== '';
  if (field.type === 'range') return (spec.min !== '' && spec.min !== undefined) || (spec.max !== '' && spec.max !== undefined) || (spec.value !== '' && spec.value !== undefined);
  return false;
}

export function formatSpec(spec, field) {
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

export function checkSpecCompat(specA, specB, field) {
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

// Directional supply→consumer check.
// Supply output range should be *contained within* consumer's acceptable input range (voltage).
// Supply capacity should be *≥* consumer's requirement (current, wattage).
export function checkSupplyCompat(supplySpec, consumerSpec, field) {
  if (!supplySpec || !consumerSpec) return 'unknown';

  if (field.type === 'text') return checkSpecCompat(supplySpec, consumerSpec, field);

  const toRange = s => {
    if (s.min !== undefined && s.min !== '' && s.max !== undefined && s.max !== '')
      return { lo: parseFloat(s.min), hi: parseFloat(s.max) };
    const v = parseFloat(s.value);
    return isNaN(v) ? null : { lo: v, hi: v };
  };

  if (field.type === 'range') {
    // Voltage-style: supply output range must sit within consumer's accepted range.
    const sR = toRange(supplySpec), cR = toRange(consumerSpec);
    if (!sR || !cR || isNaN(sR.lo) || isNaN(cR.lo)) return 'unknown';
    if (sR.lo >= cR.lo && sR.hi <= cR.hi) return 'ok';            // fully contained
    if (sR.hi >= cR.lo && sR.lo <= cR.hi) return 'warn';          // partial overlap
    return 'mismatch';                                              // no overlap
  }

  if (field.type === 'value') {
    // Current/wattage-style: supply capacity must meet consumer's draw.
    const sVal = parseFloat(supplySpec.value);
    const cVal = parseFloat(consumerSpec.value);
    if (isNaN(sVal) || isNaN(cVal)) return 'unknown';
    if (sVal >= cVal) return sVal < cVal * 1.2 ? 'warn' : 'ok';   // warn if <20% headroom
    return 'mismatch';
  }

  return 'unknown';
}

export function checkItemCompat(itemA, itemB) {
  return state.data.specFields.map(field => {
    const hv = (s) => hasSpecValue(s, field);

    if (field.directional) {
      // Directional (electrical): check inputSpecs vs outputSpecs
      const aIn  = itemA.inputSpecs?.[field.id];
      const aOut = itemA.outputSpecs?.[field.id];
      const bIn  = itemB.inputSpecs?.[field.id];
      const bOut = itemB.outputSpecs?.[field.id];
      if (hv(aOut) && hv(bIn)) return { field, status: checkSupplyCompat(aOut, bIn, field), dir: 'a→b' };
      if (hv(bOut) && hv(aIn)) return { field, status: checkSupplyCompat(bOut, aIn, field), dir: 'b→a' };
      if (hv(aIn) && hv(bIn))  return { field, status: checkSpecCompat(aIn, bIn, field), dir: 'sym' };
      if (hv(aOut) && hv(bOut)) return { field, status: checkSpecCompat(aOut, bOut, field), dir: 'sym' };
      // Legacy fallback for directional: old item.specs with isSupply flag
      const sA = itemA.specs?.[field.id], sB = itemB.specs?.[field.id];
      if (!hv(sA) || !hv(sB)) return null;
      const aS = !!itemA.isSupply, bS = !!itemB.isSupply;
      if (aS && !bS) return { field, status: checkSupplyCompat(sA, sB, field), dir: 'a→b' };
      if (!aS && bS) return { field, status: checkSupplyCompat(sB, sA, field), dir: 'b→a' };
      return { field, status: checkSpecCompat(sA, sB, field), dir: 'sym' };
    } else {
      // Non-directional: always symmetric; check item.specs (with fallback to inputSpecs/outputSpecs for migrated data)
      const sA = itemA.specs?.[field.id] || itemA.inputSpecs?.[field.id] || itemA.outputSpecs?.[field.id];
      const sB = itemB.specs?.[field.id] || itemB.inputSpecs?.[field.id] || itemB.outputSpecs?.[field.id];
      if (!hv(sA) || !hv(sB)) return null;
      return { field, status: checkSpecCompat(sA, sB, field), dir: 'sym' };
    }
  }).filter(Boolean);
}

export function overallStatus(results) {
  if (!results.length) return 'unknown';
  if (results.some(r => r.status === 'mismatch')) return 'mismatch';
  if (results.some(r => r.status === 'warn'))     return 'warn';
  if (results.some(r => r.status === 'ok'))       return 'ok';
  return 'unknown';
}

export const COMPAT_ICON  = { ok: '✅', warn: '⚠️', mismatch: '❌', unknown: '🔗' };
export const COMPAT_LABEL = { ok: 'Compatible', warn: 'Check values', mismatch: 'Incompatible', unknown: 'Linked' };
export const COMPAT_COLOR = { ok: 'var(--green)', warn: '#facc15', mismatch: '#f87171', unknown: 'var(--text-muted)' };
