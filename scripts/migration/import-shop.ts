/**
 * Imports the shop and points from Wix (company: Loc-Doc). Run after import-employees.
 *
 *   1. Catalog (UniformCatalog): items + their photos, copied off Wix into our storage.
 *   2. Birthdays (month-day only) from Wix member profiles, for the birthday points rule.
 *   3. Opening point balances from the Wix Loyalty export (one "opening" ledger row per person).
 *      At cutover this is re-run from Levi's fresh export.
 *   4. Point rules: "Birthday: 300" and "On hire" (amount blank until a Shop Admin sets it).
 *   5. Order history, following teamwix-v2/docs/ORDERS-UNIFIED.md: SanMarCMSOrders headers with
 *      their SanMarCMS / AmazonShop / WixStoreItems lines, plus every Wix Stores order not already
 *      linked to a header. History never posts to the points ledger.
 *
 * Safe to re-run (catalog upserts, opening balances and imported orders are rebuilt).
 * Usage: npx tsx scripts/migration/import-shop.ts [path/to/wix-export/<timestamp>]
 */
import { config } from "dotenv";
import { readdir, readFile } from "fs/promises";
import path from "path";
import pg from "pg";
import { saveFile, sniffImage } from "../../server/lib/storage";

config({ path: [".env.local", ".env"], quiet: true });

type Row = Record<string, any> & { _id: string };
const text = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const stamp = (v: any) => (v && typeof v === "object" && v.$date ? v.$date : typeof v === "string" && v ? v : null);
const money = (v: unknown) => { const n = Number(String(v ?? "").replace(/[$,]/g, "")); return Number.isFinite(n) ? n : 0; };

const HEADER_STATUS: Record<string, string> = {
  "pending pricing": "pending_pricing", "ready to order": "ready_to_order", "not ordered": "ready_to_order",
  ordered: "ordered", "waiting - bulk order": "waiting_bulk", "partially received": "partially_received",
  received: "received", completed: "received", "waiting for pickup": "waiting_pickup", cancelled: "cancelled", archived: "received",
};

async function newestExport(): Promise<string> {
  const root = path.resolve("../locdoc-hub-app/wix-export");
  const dirs = (await readdir(root)).sort();
  if (!dirs.length) throw new Error(`No exports in ${root}`);
  return path.join(root, dirs[dirs.length - 1]);
}

async function main() {
  const exportDir = process.argv[2] ? path.resolve(process.argv[2]) : await newestExport();
  const read = async (name: string): Promise<Row[]> => JSON.parse(await readFile(path.join(exportDir, name), "utf8"));
  const [catalog, members, loyalty, headers, sanmar, amazon, wixItems, storesOrders] = await Promise.all([
    read("collections/UniformCatalog.json"), read("collections/Members_FullData.json"), read("loyalty-accounts.json"),
    read("collections/SanMarCMSOrders.json"), read("collections/SanMarCMS.json"), read("collections/AmazonShop.json"),
    read("collections/WixStoreItems.json"), read("collections/Stores_Orders.json"),
  ]);
  const db = new pg.Client({ connectionString: process.env.PRODUCT_DATABASE_URL });
  await db.connect();
  const n = { birthdaysAlreadyPaid: 0, catalog: 0, photos: 0, photoFailures: 0, birthdays: 0, balances: 0, balanceUnmatched: 0, orders: 0, storesOrders: 0,
    lines: 0, noPerson: 0, orphanLines: 0, pointsMismatch: 0, noLines: 0 };
  try {
    await db.query("SET search_path TO employee_hub");
    const company = (await db.query("SELECT id FROM companies WHERE slug = 'loc-doc'")).rows[0];
    if (!company) throw new Error("Run import-employees first (no Loc-Doc company).");
    const admin = (await db.query(`SELECT ra.employee_id AS id FROM role_assignments ra JOIN roles r ON r.id = ra.role_id WHERE r.key = 'super_admin' LIMIT 1`)).rows[0];
    const emps = (await db.query("SELECT id, lower(email) AS email, first_name || ' ' || last_name AS name FROM employees")).rows;
    const byEmail = new Map(emps.map((e) => [e.email as string, e]));
    const memberEmail = new Map(members.map((m) => [m._id, text(m.loginEmail || m.email).toLowerCase()]));
    const person = (email: string, memberId?: string) =>
      byEmail.get(email.toLowerCase()) ?? (memberId ? byEmail.get(memberEmail.get(memberId) ?? "") : undefined);

    // 1. Catalog + photos (photo download happens before the transaction: it's network, not data).
    const existingPhotos = new Map((await db.query("SELECT id, image_upload_id FROM catalog_items")).rows.map((r) => [r.id, r.image_upload_id]));
    const photoFor = new Map<string, string | null>();
    for (const c of catalog) {
      if (existingPhotos.get(c._id)) { photoFor.set(c._id, existingPhotos.get(c._id)); continue; }
      let uploadId: string | null = null;
      try {
        const r = await fetch(text(c.image));
        const bytes = Buffer.from(await r.arrayBuffer());
        const kind = r.ok ? sniffImage(bytes) : null;
        if (kind) {
          const key = await saveFile(bytes, kind.ext);
          uploadId = (await db.query(
            `INSERT INTO uploads (company_id, uploaded_by_id, purpose, content_type, byte_size, storage_key) VALUES ($1,$2,'catalog',$3,$4,$5) RETURNING id`,
            [company.id, admin.id, kind.contentType, bytes.length, key])).rows[0].id;
          n.photos++;
        } else n.photoFailures++;
      } catch { n.photoFailures++; }
      photoFor.set(c._id, uploadId);
    }

    await db.query("BEGIN");
    for (const c of catalog) {
      let opts: unknown = [];
      try { opts = JSON.parse(c.productOptions || "[]"); } catch { opts = []; }
      await db.query(
        `INSERT INTO catalog_items (id, name, price, image_upload_id, options, is_visible, legacy_wix_product_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price, image_upload_id = coalesce(EXCLUDED.image_upload_id, catalog_items.image_upload_id),
           options = EXCLUDED.options, is_visible = EXCLUDED.is_visible, legacy_wix_product_id = EXCLUDED.legacy_wix_product_id, updated_at = now()`,
        [c._id, text(c.name), money(c.price), photoFor.get(c._id), JSON.stringify(opts), c.visible !== false, text(c.sourceProductId) || null]);
      n.catalog++;
    }
    const catalogByWixProduct = new Map(catalog.filter((c) => c.sourceProductId).map((c) => [text(c.sourceProductId), c._id]));

    // 2. Birthdays.
    for (const m of members) {
      const bd = text(m.customfields_contact_birthdate);
      const e = byEmail.get(text(m.loginEmail || m.email).toLowerCase());
      if (e && /^\d{4}-\d{2}-\d{2}/.test(bd)) {
        await db.query("UPDATE employees SET birthday_md = $2 WHERE id = $1 AND birthday_md IS DISTINCT FROM $2", [e.id, bd.slice(5, 10)]);
        n.birthdays++;
      }
    }

    // 3. Opening balances (replaced on every run).
    await db.query("DELETE FROM point_transactions WHERE company_id = $1 AND kind = 'opening'", [company.id]);
    for (const a of loyalty) {
      const e = person("", text(a.memberId));
      const balance = Math.round(Number(a.points?.balance ?? 0));
      if (!e) { n.balanceUnmatched++; continue; }
      if (!balance) continue;
      await db.query(`INSERT INTO point_transactions (company_id, employee_id, amount, kind, reason) VALUES ($1,$2,$3,'opening','Starting balance from Wix Loyalty')`,
        [company.id, e.id, balance]);
      n.balances++;
    }

    // 4. Rules (created once).
    const haveRules = (await db.query("SELECT count(*)::int AS c FROM point_rules WHERE company_id = $1", [company.id])).rows[0].c;
    if (!haveRules) {
      await db.query(`INSERT INTO point_rules (company_id, name, trigger, amount) VALUES ($1,'Birthday','birthday',300), ($1,'On hire','on_hire',NULL)`, [company.id]);
    }
    // Wix Loyalty already paid this year's birthdays up to the export date, and those points are in
    // the opening balances above. Mark them paid so the birthday rule never pays them a second time.
    const exportDate = path.basename(exportDir).slice(0, 10);
    const year = exportDate.slice(0, 4);
    const marked = await db.query(
      `INSERT INTO point_rule_awards (rule_id, employee_id, period, transaction_id, paid_by)
       SELECT r.id, e.id, $3, NULL, 'wix_loyalty' FROM point_rules r JOIN employees e ON e.company_id = r.company_id
        WHERE r.company_id = $1 AND r.trigger = 'birthday' AND e.birthday_md IS NOT NULL AND e.birthday_md <= $2
       ON CONFLICT DO NOTHING`, [company.id, exportDate.slice(5), year]);
    n.birthdaysAlreadyPaid = marked.rowCount ?? 0;

    // 5. Orders (imported ones rebuilt on every run).
    await db.query("DELETE FROM orders WHERE company_id = $1 AND legacy_source IS NOT NULL", [company.id]);
    const linesFor = (h: Row): Row[] => {
      const src = text(h.shopSource) || "sanmar";
      return (src === "amazon" ? amazon : src === "wixstore" ? wixItems : sanmar).filter((l) => l.orderRef === h._id);
    };
    const storesById = new Map(storesOrders.map((o) => [o._id, o]));
    const linkedStores = new Set<string>();
    const insertOrder = async (o: Record<string, unknown>) =>
      (await db.query(
        `INSERT INTO orders (company_id, order_type, employee_id, customer_name, customer_email, status, archived_at, is_stock_order,
           points_estimated, points_charged, pricing_confirmed, ordered_at, est_delivery, cancelled_at, cancel_reason, admin_notes,
           legacy_source, legacy_id, legacy_number, legacy_wix_order_id, order_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NULL) RETURNING id`,
        [company.id, o.type, o.employeeId, o.name, o.email, o.status, o.archivedAt, o.stock, o.estimated, o.charged, o.confirmed,
         o.orderedAt, o.estDelivery, o.cancelledAt, o.cancelReason, o.notes, o.legacySource, o.legacyId, o.legacyNumber, o.wixOrderId])).rows[0].id;
    const insertLine = async (orderId: string, l: Record<string, unknown>) => {
      await db.query(
        `INSERT INTO order_items (order_id, catalog_item_id, name, sku, link, quantity, unit_price, line_total, refunded_quantity, options, branding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [orderId, l.catalogItemId ?? null, l.name ?? "", l.sku ?? "", l.link ?? null, Math.max(1, Math.round(Number(l.quantity) || 1)),
         l.unitPrice ?? 0, l.total ?? 0, l.refunded ?? 0, JSON.stringify(l.options ?? {}), JSON.stringify(l.branding ?? {})]);
      n.lines++;
    };
    const storesLines = (o: Row) => (o.lineItems ?? []).map((li: Row) => ({
      name: text(li.name), sku: text(li.sku), quantity: li.quantity, unitPrice: money(li.price), total: money(li.totalPrice),
      refunded: Number(li.refundedQuantity) || 0, catalogItemId: catalogByWixProduct.get(text(li.productId)) ?? null,
      options: Object.fromEntries((li.options ?? []).map((x: Row) => [text(x.option), text(x.selection)])),
    }));

    for (const h of headers) {
      const type = text(h.shopSource) === "amazon" ? "amazon" : text(h.shopSource) === "wixstore" ? "uniform" : "sanmar";
      const raw = text(h.status).toLowerCase();
      const e = person(text(h.customerEmail), text(h.memberId));
      if (!e) n.noPerson++;
      const charged = Math.round(Number(h.chargedPoints ?? h.totalPoints ?? 0));
      const id = await insertOrder({
        type, employeeId: e?.id ?? null, name: `${text(h.firstName)} ${text(h.lastName)}`.trim() || e?.name || "Unknown",
        email: text(h.customerEmail), status: HEADER_STATUS[raw] ?? "ordered", archivedAt: raw === "archived" || h.archived === true ? stamp(h.archivedAt) ?? stamp(h._updatedDate) : null,
        stock: h.isStockOrder === true, estimated: h.estimatedPoints != null ? Math.round(Number(h.estimatedPoints)) : null, charged,
        confirmed: h.pricingConfirmed === true, orderedAt: stamp(h.dateOrdered) ?? stamp(h._createdDate), estDelivery: stamp(h.estDelivery)?.slice(0, 10) ?? null,
        cancelledAt: stamp(h.cancelledAt), cancelReason: text(h.cancelReason) || null, notes: text(h.adminNotes),
        legacySource: "sanmar_cms_orders", legacyId: h._id, legacyNumber: text(h.orderNumber) || text(h.orderIdNumeric), wixOrderId: text(h.sourceOrderId) || null,
      });
      n.orders++;
      let lines = linesFor(h);
      if (type === "uniform" && !lines.length && h.sourceOrderId && storesById.has(h.sourceOrderId)) {
        for (const l of storesLines(storesById.get(h.sourceOrderId)!)) await insertLine(id, l);
      } else {
        if (!lines.length) n.noLines++;
        let sum = 0;
        for (const l of lines) {
          sum += money(l.total);
          await insertLine(id, type === "sanmar" ? {
            name: text(l.itemNumber), sku: text(l.itemNumber), quantity: l.quantity, unitPrice: money(l.clothingPrice) + money(l.logoPricePerUnit) + money(l.placementPricePerUnit),
            total: money(l.total), options: Object.fromEntries(Object.entries({ Size: l.size, Color: l.color, "Pant size": l.pantSize, Inseam: l.inseam, "Hat size": l.hatSize }).filter(([, v]) => text(v))),
            branding: { logo: text(l.logo), logoColor: text(l.logoColor), placement: text(l.logoPlacement), logoPricePerUnit: money(l.logoPricePerUnit), placementPricePerUnit: money(l.placementPricePerUnit), isHat: l.isHat === true, isPants: l.isPants === true },
          } : type === "amazon" ? {
            name: text(l.name) || "Amazon item", link: text(l.link) || null, quantity: l.quantity, unitPrice: money(l.unitPrice), total: money(l.total),
            options: Object.fromEntries(Object.entries({ Size: l.size, Color: l.color, Width: l.width }).filter(([, v]) => text(v))),
          } : {
            name: text(l.name), sku: text(l.sku), quantity: l.quantity, unitPrice: money(l.unitPrice), total: money(l.total),
            catalogItemId: catalogByWixProduct.get(text(l.productId)) ?? null, options: text(l.variantInfo) ? { Details: text(l.variantInfo) } : {},
          });
        }
        if (lines.length && Math.abs(sum - charged) >= 1) n.pointsMismatch++;
      }
      if (h.sourceOrderId) linkedStores.add(h.sourceOrderId);
      lines = [];
    }
    const headerIds = new Set(headers.map((h) => h._id));
    n.orphanLines = [...sanmar, ...amazon, ...wixItems].filter((l) => !headerIds.has(l.orderRef)).length;

    for (const o of storesOrders) {
      if (linkedStores.has(o._id)) continue;
      const b = o.buyerInfo ?? {};
      const e = person(text(b.email), text(b.id));
      if (!e) n.noPerson++;
      const pay = text(o.paymentStatus), ful = text(o.fulfillmentStatus);
      const status = ful === "CANCELED" || pay === "FULLY_REFUNDED" ? "cancelled" : ful === "FULFILLED" ? "received" : pay === "PAID" ? "ordered" : "ready_to_order";
      const loyaltyCoupon = /loyalty/i.test(text(o.discount?.appliedCoupon?.name));
      const id = await insertOrder({
        type: "uniform", employeeId: e?.id ?? null, name: `${text(b.firstName)} ${text(b.lastName)}`.trim() || e?.name || "Unknown", email: text(b.email),
        status, archivedAt: o.archived === true ? stamp(o._updatedDate) ?? stamp(o._dateCreated) : null, stock: false, estimated: null,
        charged: Math.round(loyaltyCoupon ? money(o.totals?.discount) : money(o.totals?.subtotal)), confirmed: true,
        orderedAt: stamp(o._dateCreated), estDelivery: null, cancelledAt: status === "cancelled" ? stamp(o._updatedDate) : null, cancelReason: null, notes: "",
        legacySource: "wix_stores", legacyId: o._id, legacyNumber: text(o.number), wixOrderId: o._id,
      });
      for (const l of storesLines(o)) await insertLine(id, l);
      n.storesOrders++;
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
  console.log(`Imported from ${exportDir}`);
  console.log(`  catalog: ${n.catalog} items, ${n.photos} photos copied (${n.photoFailures} failed)`);
  console.log(`  birthdays: ${n.birthdays} (${n.birthdaysAlreadyPaid} already paid by Wix this year, marked so they aren't paid twice); opening balances: ${n.balances} (${n.balanceUnmatched} Loyalty accounts with no matching employee)`);
  console.log(`  orders: ${n.orders} from SanMar/Amazon/uniform headers + ${n.storesOrders} older Wix Stores orders, ${n.lines} lines`);
  console.log(`  report: ${n.noPerson} orders from people no longer listed (name/email kept), ${n.orphanLines} orphan lines skipped, ${n.noLines} headers with no lines, ${n.pointsMismatch} where points ≠ line totals`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
