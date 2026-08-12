import { symOf } from '../currency.js';

// ── URL Auto-fill ─────────────────────────────────────────────────────────────

export function detectPlatformFromUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('amazon'))     return 'amazon';
    if (host.includes('lazada'))     return 'lazada';
    if (host.includes('aliexpress')) return 'aliexpress';
    if (host.includes('ebay'))       return 'ebay';
    if (host.includes('shopee'))     return 'shopee';
  } catch {}
  return null;
}

export function detectCurrencySymFromUrl(url) {
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

export function extractPriceFromHtml(html) {
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

export async function fetchProductData(url, onStatus) {
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
