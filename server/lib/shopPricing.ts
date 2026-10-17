// @ts-nocheck: copied unchanged from locdoc-hub-ui/src/elements/shop-pricing.js so the money math
// stays byte-for-byte identical to the Wix shop. Its 20 reference tests run in tests/shopPricing.test.ts.

/**
 * Shop pricing — SOURCE OF TRUTH for every line total in the unified Shop.
 *
 * Pure functions, no Wix APIs: runs in plain Node (tested), in the browser (the element's live
 * price preview), and in the Wix backend (the authoritative total at checkout). It is synced into
 * teamwix as `backend/shop-pricing.js`, the same way `scoring-core.js` is.
 *
 * WHY THIS EXISTS
 * The old shop had these rules written twice — once in `San Mar Shop.awvof.js` and once in
 * `sanmarPricing.jsw` — free to drift. Worse, `submitSanmarOrder` TRUSTED the client's `total`
 * whenever its own math produced 0, so a crafted cart could set its own price. Here, a line total
 * is ALWAYS recomputed from its inputs; a submitted `total` is ignored outright. The only value the
 * client supplies is the price the user typed (SanMar/Amazon items have no catalog to look it up
 * in), and the fee math on top of it is ours.
 *
 * RULES (preserved exactly from the current SanMar shop — this is the behavioural contract):
 *   • Garments with a logo pay a flat $3 logo fee per unit.
 *   • HATS NEVER PAY THE GARMENT LOGO FEE. A hat with a logo pays only its placement fee:
 *     front 3.5, side 6, back 6. A hat with a logo but no placement pays 0 (validation forces one).
 *   • "No logo" means empty, or one of NONE_LOGO_VALUES, or anything starting with "select ".
 */

/**
 * ORDER STATUSES — the single source of truth. n8n automations key off these exact strings, so
 * they are hard to change once live. Treat them as a contract.
 *
 * Flow:
 *   Pending Pricing  → custom (SanMar/Amazon) items whose typed price the admin hasn't confirmed.
 *                      The ESTIMATE has already been deducted at submit.
 *   Ready to Order   → pricing confirmed and the points difference settled. Uniform items land
 *                      here directly: the catalog price is already established.
 *   Ordered          → sent to the vendor. THIS IS THE AUTOMATION TRIGGER.
 *   Partially Received / Received → fulfilment.
 *   Waiting for Pickup → item is in-house but the member hasn't picked it up yet.
 *   Cancelled        → admin killed it; points are refunded in full.
 *   Archived         → off the board (terminal, pre-existing).
 */
export const STATUS = {
  PENDING_PRICING: 'Pending Pricing',
  READY_TO_ORDER: 'Ready to Order',
  ORDERED: 'Ordered',
  // Held because the item ships only in bulk (e.g. hats come in a case of 12), so we sit on the
  // order until enough accumulate to place it. The member's points stay charged while it waits.
  WAITING_BULK: 'Waiting - Bulk Order',
  PARTIALLY_RECEIVED: 'Partially Received',
  RECEIVED: 'Received',
  WAITING_PICKUP: 'Waiting for Pickup',
  CANCELLED: 'Cancelled',
  ARCHIVED: 'Archived',
};

/**
 * Statuses a member can see on their own orders. Anything NOT in this list vanishes from the
 * member's page with no error — which is exactly how the old shop lost orders whenever someone
 * added a status option in the editor. Add a status here the moment you add it above.
 *
 * 'Not Ordered' is retained: it's the legacy initial status on every existing row.
 */
const MEMBER_VISIBLE = [
  'not ordered',
  STATUS.PENDING_PRICING,
  STATUS.READY_TO_ORDER,
  STATUS.ORDERED,
  STATUS.WAITING_BULK,
  STATUS.PARTIALLY_RECEIVED,
  STATUS.RECEIVED,
  STATUS.WAITING_PICKUP,
  'completed', // legacy synonym for Received — see displayStatus
].map((s) => s.toLowerCase());

export function isMemberVisibleStatus(status) {
  return MEMBER_VISIBLE.includes(String(status == null ? '' : status).trim().toLowerCase());
}

/**
 * Older orders were closed out as "Completed"; the current workflow calls the same end state
 * "Received". They mean the same thing, so normalise "Completed" → "Received" for DISPLAY only —
 * the stored value is left as-is. Everything else passes through unchanged.
 */
const STATUS_DISPLAY_ALIASES = { completed: STATUS.RECEIVED };
export function displayStatus(status) {
  const key = String(status == null ? '' : status).trim().toLowerCase();
  return STATUS_DISPLAY_ALIASES[key] || (status == null ? '' : String(status));
}

/** Custom items need an admin to confirm the price; catalog items are already priced. */
export function needsPricingConfirmation(source) {
  return source === 'sanmar' || source === 'amazon';
}

/** Shirt / jacket logo add-on per garment (not hats). */
export const GARMENT_LOGO_FEE_PER_UNIT = 3;

/** Hat logo fee per hat by placement. Includes the logo — hats pay no separate garment logo fee. */
export const HAT_LOGO_PLACEMENT_FEES = {
  'Front': 3.5,
  'Front Center': 3.5,
  'Left Side': 6,
  'Right Side': 6,
  'Back': 6,
  'None': 0,
};

const NONE_LOGO_VALUES = new Set([
  '', 'none', 'no', 'no logo', 'n/a', 'select a logo', 'select logo', 'choose a logo',
]);

/** Money in any shape the UI might hand us ("$24.00", "24", 24) → a number. Never NaN. */
export function parseMoney(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v == null ? '' : v).trim().replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function qtyOf(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

const round2 = (n) => Math.round(n * 100) / 100;

/** A logo selection that actually costs money (i.e. not "none" and not a placeholder option). */
export function hasLogoCharge(logo) {
  const key = String(logo == null ? '' : logo).trim().toLowerCase();
  if (!key || NONE_LOGO_VALUES.has(key)) return false;
  return !key.startsWith('select ');
}

/** Hat placement fee. Exact match first, then a substring fallback for editor label drift. */
export function hatPlacementFee(placement) {
  const key = String(placement == null ? '' : placement).trim();
  if (!key || NONE_LOGO_VALUES.has(key.toLowerCase())) return 0;
  if (Object.prototype.hasOwnProperty.call(HAT_LOGO_PLACEMENT_FEES, key)) {
    return HAT_LOGO_PLACEMENT_FEES[key];
  }
  const lower = key.toLowerCase();
  if (lower.includes('front')) return 3.5;
  if (lower.includes('back')) return 6;
  if (lower.includes('side')) return 6;
  return 0;
}

/** Per-unit logo/placement fees for a SanMar line. Hats: placement only. Garments: flat fee only. */
export function logoFeesPerUnit(line) {
  if (!hasLogoCharge(line && line.logo)) return { logoPerUnit: 0, placementPerUnit: 0 };
  if (line && line.isHat) {
    return { logoPerUnit: 0, placementPerUnit: hatPlacementFee(line.logoPlacement) };
  }
  return { logoPerUnit: GARMENT_LOGO_FEE_PER_UNIT, placementPerUnit: 0 };
}

/**
 * Price one SanMar line. `clothingPrice` is what the user typed; everything else is derived.
 * Any `total` on the input is deliberately ignored.
 */
export function priceSanmarLine(line) {
  const quantity = qtyOf(line && line.quantity);
  const clothingPrice = parseMoney(line && line.clothingPrice);
  const { logoPerUnit, placementPerUnit } = logoFeesPerUnit(line || {});
  const unitPrice = round2(clothingPrice + logoPerUnit + placementPerUnit);
  return {
    clothingPrice,
    logoPricePerUnit: logoPerUnit,
    placementPricePerUnit: placementPerUnit,
    unitPrice,
    quantity,
    total: round2(unitPrice * quantity),
  };
}

/** Amazon and uniform lines are a flat unit price × quantity — no fee math. */
export function priceFlatLine(line) {
  const quantity = qtyOf(line && line.quantity);
  const unitPrice = parseMoney(line && (line.unitPrice != null ? line.unitPrice : line.price));
  return { unitPrice, quantity, total: round2(unitPrice * quantity) };
}

/** Price any line by its source. The one entry point both the element and the backend call. */
export function priceLine(line) {
  return (line && line.source) === 'sanmar' ? priceSanmarLine(line) : priceFlatLine(line);
}

/**
 * OUR cost vs. the member's price. The member is always charged full price (that's `priceLine`).
 * Our uniform provider discounts 15% on any single item over $25, so what the COMPANY actually pays
 * is lower on those lines. This is an admin-only figure — it never changes what a member is charged.
 */
export const BULK_DISCOUNT_RATE = 0.15;
export const BULK_DISCOUNT_THRESHOLD = 25;

/** The discounted unit price we pay: 15% off when a single unit is over $25, otherwise full. */
export function ourUnitPrice(unitPrice) {
  const p = parseMoney(unitPrice);
  return p > BULK_DISCOUNT_THRESHOLD ? round2(p * (1 - BULK_DISCOUNT_RATE)) : p;
}

/** What the company pays for one line after the bulk discount (fees included, discounted per unit). */
export function ourCostForLine(line) {
  const p = priceLine(line);
  return round2(ourUnitPrice(p.unitPrice) * p.quantity);
}

/** Cart total, recomputed from the lines — never summed from client-supplied totals. */
export function cartTotal(lines) {
  return round2((lines || []).reduce((sum, l) => sum + priceLine(l).total, 0));
}

/** Points charged for a cart. Points are 1:1 with dollars, rounded to a whole point. */
export function pointsForCart(lines) {
  return Math.round(cartTotal(lines));
}

/**
 * Validation, in the exact order (and with the exact messages) the current SanMar shop uses, so the
 * behaviour techs are used to is preserved. Returns null when the line is valid.
 */
export function validateLine(line) {
  const l = line || {};
  const source = l.source;

  if (source === 'amazon') {
    if (!/^https?:\/\//i.test(String(l.link || '').trim())) return 'Enter a valid http(s) link.';
    if (priceFlatLine(l).total <= 0) return 'Enter a valid quantity and price.';
    return null;
  }

  if (source === 'uniform') {
    if (!l.productId) return 'Pick a product.';
    // Uniform items carry whatever option dimensions the Wix Store product actually defines (Size,
    // Color, Inseam, whatever) rather than a hardcoded size/color pair — see shop.web.js's
    // productOptionList. optionLabels is the full list the form asked for; fall back to whatever
    // keys got selected if it's missing, so an old/cached line doesn't hard-fail validation.
    const opts = l.selectedOptions || {};
    const labels = Array.isArray(l.optionLabels) && l.optionLabels.length ? l.optionLabels : Object.keys(opts);
    if (!labels.length) return 'Select an option.';
    const missing = labels.find((label) => !String(opts[label] || '').trim());
    if (missing) return `${missing} is required.`;
    return null;
  }

  // sanmar
  if (!String(l.itemNumber || '').trim()) return 'Enter an item number.';
  if (priceSanmarLine(l).total <= 0) return 'Enter a valid clothing price to calculate total.';
  if (parseMoney(l.clothingPrice) <= 0) return 'Enter the clothing price (logo is added separately).';
  if (!(Number(l.quantity) > 0)) return 'Enter a valid quantity.';
  if (!String(l.color || '').trim()) return 'Enter a color.';
  if (l.isHat) {
    if (!String(l.hatSize || '').trim()) return 'Select a hat size.';
    if (hasLogoCharge(l.logo) && !String(l.logoPlacement || '').trim()) {
      return 'Select logo placement for hat orders with a logo.';
    }
  }
  if (l.isPants) {
    if (!String(l.pantSize || '').trim()) return 'Enter pant size.';
    if (!String(l.inseam || '').trim()) return 'Enter inseam.';
  }
  if (!l.isHat && !l.isPants && !String(l.size || '').trim()) return 'Enter a size.';
  if (hasLogoCharge(l.logo) && !String(l.logoColor || '').trim()) return 'Select a logo color.';
  return null;
}
