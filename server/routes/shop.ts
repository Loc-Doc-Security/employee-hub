/**
 * Shop + points API. Same workflow as the Wix shop (shop.web.js / shopAdmin.web.js):
 *   - Uniform items are priced from the catalog (the database, never the browser) → Ready to Order.
 *   - SanMar / Amazon items use the member's typed price → Pending Pricing, with the ESTIMATE charged
 *     up front so nobody overspends while it waits. A Shop Admin confirms real prices; the difference
 *     is charged or credited back. Cancelling refunds everything charged.
 *   - A mixed cart becomes one order per type; the points for the whole cart are checked together.
 *   - All money math is server/lib/shopPricing.ts (identical to the Wix module).
 *
 * Member:   GET  /api/shop/init                     catalog, my balance, which order types I may use, my orders
 *           POST /api/shop/quote  { lines }         server-priced preview
 *           POST /api/shop/orders { lines }         place the cart
 *           GET  /api/shop/points                   my balance + history
 * Shop Admin (shop.admin):
 *           GET   /api/shop/admin/orders?view=open|archived|all
 *           POST  /api/shop/admin/orders/:id/confirm { lines: [{ id, price }] }
 *           PATCH /api/shop/admin/orders/:id        { status?, adminNotes?, estDelivery?, archived? }
 *           POST  /api/shop/admin/orders/:id/cancel { reason }
 *           POST  /api/shop/admin/stock-order       { lines }   (no points; stock for the shelf)
 *           GET/POST /api/shop/admin/catalog, PATCH /api/shop/admin/catalog/:id
 * Points (points.manage):
 *           GET  /api/points/admin                  everyone's balance
 *           GET  /api/points/admin/:employeeId      one person's history
 *           POST /api/points/admin/adjust           { employeeId, amount, reason }
 *           GET/POST /api/points/admin/rules, PATCH /api/points/admin/rules/:id
 */
import type express from "express";
import type pg from "pg";
import { getProductDb } from "../db/client";
import { resolveCurrent, type GetAuthUser } from "../auth/currentEmployee";
import { canAnywhereIn, type Access } from "../auth/permissions";
import { balanceOf, post, runPointRules } from "../lib/points";
import { localDate } from "../lib/weeks";
import { STATUS, displayStatus, needsPricingConfirmation, priceLine, validateLine } from "../lib/shopPricing";

const send = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ ok: false, error });
const UUID = /^[0-9a-f-]{36}$/i;

// Wix status names ↔ stored keys.
const STATUS_KEY: Record<string, string> = {
  [STATUS.PENDING_PRICING]: "pending_pricing", [STATUS.READY_TO_ORDER]: "ready_to_order", [STATUS.ORDERED]: "ordered",
  [STATUS.WAITING_BULK]: "waiting_bulk", [STATUS.PARTIALLY_RECEIVED]: "partially_received", [STATUS.RECEIVED]: "received",
  [STATUS.WAITING_PICKUP]: "waiting_pickup", [STATUS.CANCELLED]: "cancelled",
};
const STATUS_NAME = Object.fromEntries(Object.entries(STATUS_KEY).map(([n, k]) => [k, n]));
const ADMIN_SETTABLE = ["pending_pricing", "ready_to_order", "ordered", "waiting_bulk", "partially_received", "received", "waiting_pickup"];
const TYPE_PERMISSION: Record<string, string> = { uniform: "shop.order.uniform", sanmar: "shop.order.sanmar", amazon: "shop.order.amazon" };

type Line = Record<string, any> & { source: "uniform" | "sanmar" | "amazon" };
type CatalogItem = { id: string; name: string; price: string; options: { label: string; choices: string[] }[]; is_visible: boolean };

/** Validates and prices cart lines against the real catalog. Uniform prices come from the database. */
async function priceCart(db: pg.Pool | pg.PoolClient, raw: unknown) {
  if (!Array.isArray(raw) || !raw.length) throw new Error("The cart is empty.");
  if (raw.length > 50) throw new Error("That's too many lines for one cart.");
  const ids = raw.map((l: Line) => l?.productId).filter((id: unknown) => typeof id === "string" && UUID.test(id as string));
  const catalog = new Map<string, CatalogItem>(ids.length ? (await db.query(
    "SELECT id, name, price, options, is_visible FROM employee_hub.catalog_items WHERE id = ANY($1::uuid[])", [ids])).rows.map((c) => [c.id, c]) : []);
  return raw.map((input: Line, i: number) => {
    const source = input?.source;
    if (!["uniform", "sanmar", "amazon"].includes(source)) throw new Error(`Line ${i + 1}: unknown item type.`);
    let line: Line = { ...input };
    if (source === "uniform") {
      const item = catalog.get(input.productId);
      if (!item || !item.is_visible) throw new Error(`Line ${i + 1}: that catalog item isn't available.`);
      const selected = (input.selectedOptions ?? {}) as Record<string, string>;
      for (const opt of item.options) {
        if (!opt.choices.includes(String(selected[opt.label] ?? ""))) throw new Error(`Line ${i + 1}: pick a valid ${opt.label}.`);
      }
      line = { ...input, unitPrice: Number(item.price), price: Number(item.price), optionLabels: item.options.map((o) => o.label), name: item.name };
      if (!item.options.length) line.optionLabels = ["Item"], line.selectedOptions = { Item: item.name };
    }
    const problem = validateLine(line);
    if (problem) throw new Error(`Line ${i + 1}: ${problem}`);
    return { line, priced: priceLine(line) as { unitPrice: number; quantity: number; total: number; clothingPrice?: number; logoPricePerUnit?: number; placementPricePerUnit?: number } };
  });
}

function itemRow(line: Line, priced: ReturnType<typeof priceLine>) {
  const p = priced as { unitPrice: number; quantity: number; total: number; logoPricePerUnit?: number; placementPricePerUnit?: number; clothingPrice?: number };
  if (line.source === "uniform") {
    return { catalogItemId: line.productId, name: line.name, sku: "", link: null, options: line.selectedOptions ?? {}, branding: {} };
  }
  if (line.source === "amazon") {
    return { catalogItemId: null, name: String(line.name ?? "Amazon item").slice(0, 200), sku: "", link: String(line.link ?? "").trim(),
      options: Object.fromEntries(Object.entries({ Size: line.size, Color: line.color, Width: line.width }).filter(([, v]) => String(v ?? "").trim())), branding: {} };
  }
  return { catalogItemId: null, name: String(line.itemNumber ?? "").trim(), sku: String(line.itemNumber ?? "").trim(), link: null,
    options: Object.fromEntries(Object.entries({ Size: line.size, Color: line.color, "Pant size": line.pantSize, Inseam: line.inseam, "Hat size": line.hatSize }).filter(([, v]) => String(v ?? "").trim())),
    branding: { logo: line.logo ?? "", logoColor: line.logoColor ?? "", placement: line.logoPlacement ?? "", isHat: !!line.isHat, isPants: !!line.isPants,
      clothingPrice: p.clothingPrice, logoPricePerUnit: p.logoPricePerUnit, placementPricePerUnit: p.placementPricePerUnit } };
}

const ORDER_COLUMNS = `o.id, o.order_number, o.legacy_number, o.order_type, o.employee_id, o.customer_name, o.status, o.archived_at,
  o.is_stock_order, o.points_estimated, o.points_charged, o.pricing_confirmed, o.ordered_at, o.est_delivery::text AS est_delivery,
  o.cancel_reason, o.admin_notes,
  coalesce((SELECT json_agg(json_build_object('id', i.id, 'name', i.name, 'sku', i.sku, 'link', i.link, 'quantity', i.quantity,
     'unitPrice', i.unit_price::float, 'total', i.line_total::float, 'options', i.options, 'branding', i.branding) ORDER BY i.name)
     FROM employee_hub.order_items i WHERE i.order_id = o.id), '[]') AS items`;
const withStatusName = (rows: Record<string, unknown>[]) => rows.map((r) => ({ ...r, statusName: displayStatus(STATUS_NAME[r.status as string] ?? r.status) }));

export function registerShopRoutes(app: express.Express, getAuthUser: GetAuthUser) {
  const me = async (req: express.Request, res: express.Response, permission?: string) => {
    const current = await resolveCurrent(req, getAuthUser);
    if (!current) return void fail(res, 401, "Sign in required");
    const access = current.access;
    if (!access) return void fail(res, 403, "No employee profile for this account");
    if (permission && !canAnywhereIn(access, permission, access.companyId)) return void fail(res, 403, permission === "points.manage" ? "Shop Admins only (points)" : "Shop Admins only");
    return access;
  };
  const allowedTypes = (access: Access) => Object.entries(TYPE_PERMISSION).filter(([, p]) => canAnywhereIn(access, p, access.companyId)).map(([t]) => t);

  // Automatic point rules: hourly, plus shortly after start-up. Idempotent, so overlapping runs or
  // several server instances are harmless.
  const runRules = () => runPointRules(getProductDb(), localDate(new Date()))
    .then((n) => n && console.info(`[points] paid ${n} automatic award(s)`))
    .catch((err) => console.error("[points] rules run failed:", (err as Error).message));
  setTimeout(runRules, 30_000).unref();
  setInterval(runRules, 60 * 60_000).unref();

  app.get("/api/shop/init", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const db = getProductDb();
      const catalog = (await db.query("SELECT id, name, price::float AS price, image_upload_id, options FROM employee_hub.catalog_items WHERE is_visible ORDER BY name")).rows;
      const orders = (await db.query(`SELECT ${ORDER_COLUMNS} FROM employee_hub.orders o WHERE o.employee_id = $1 AND NOT o.is_stock_order ORDER BY o.ordered_at DESC LIMIT 100`, [access.employeeId])).rows;
      send(res, {
        catalog, balance: await balanceOf(db, access.employeeId), allowedTypes: allowedTypes(access), orders: withStatusName(orders),
        isShopAdmin: canAnywhereIn(access, "shop.admin", access.companyId), canManagePoints: canAnywhereIn(access, "points.manage", access.companyId),
      });
    } catch (err) {
      fail(res, 500, `Could not load the shop: ${(err as Error).message}`);
    }
  });

  app.post("/api/shop/quote", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const priced = await priceCart(getProductDb(), req.body?.lines);
      const total = Math.round(priced.reduce((s, x) => s + x.priced.total, 0) * 100) / 100;
      send(res, { lines: priced.map((x) => x.priced), total, points: Math.round(total), balance: await balanceOf(getProductDb(), access.employeeId) });
    } catch (err) {
      fail(res, 400, (err as Error).message);
    }
  });

  app.post("/api/shop/orders", async (req, res) => {
    const pool = getProductDb();
    const client = await pool.connect();
    try {
      const access = await me(req, res);
      if (!access) return;
      const priced = await priceCart(client, req.body?.lines);
      const allowed = allowedTypes(access);
      const blocked = priced.find((x) => !allowed.includes(x.line.source));
      if (blocked) return void fail(res, 403, `You can't order ${blocked.line.source === "uniform" ? "uniform" : blocked.line.source === "sanmar" ? "SanMar" : "Amazon"} items.`);
      const emp = (await client.query("SELECT first_name || ' ' || last_name AS name, email FROM employee_hub.employees WHERE id = $1", [access.employeeId])).rows[0];

      await client.query("BEGIN");
      const byType = new Map<string, typeof priced>();
      for (const x of priced) byType.set(x.line.source, [...(byType.get(x.line.source) ?? []), x]);
      const cartPoints = Math.round(priced.reduce((s, x) => s + x.priced.total, 0));
      const balance = await balanceOf(client, access.employeeId);
      if (cartPoints > balance) throw new Error(`Not enough points: this cart is ${cartPoints}, your balance is ${balance}.`);

      const created: { id: string; number: number; type: string; points: number }[] = [];
      for (const [type, lines] of byType) {
        const points = Math.round(lines.reduce((s, x) => s + x.priced.total, 0));
        const status = needsPricingConfirmation(type) ? "pending_pricing" : "ready_to_order";
        const o = (await client.query(
          `INSERT INTO employee_hub.orders (company_id, order_type, employee_id, customer_name, customer_email, status, points_estimated, points_charged, pricing_confirmed)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8) RETURNING id, order_number`,
          [access.companyId, type, access.employeeId, emp.name, emp.email, status, points, !needsPricingConfirmation(type)])).rows[0];
        for (const x of lines) {
          const r = itemRow(x.line, x.priced);
          await client.query(
            `INSERT INTO employee_hub.order_items (order_id, catalog_item_id, name, sku, link, quantity, unit_price, line_total, options, branding)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [o.id, r.catalogItemId, r.name, r.sku, r.link, x.priced.quantity, x.priced.unitPrice, x.priced.total, JSON.stringify(r.options), JSON.stringify(r.branding)]);
        }
        if (points > 0) {
          await post(client, { companyId: access.companyId, employeeId: access.employeeId, amount: -points, kind: "order_charge",
            reason: `Order #${o.order_number}${needsPricingConfirmation(type) ? " (estimate)" : ""}`, orderId: o.id, createdById: access.employeeId, mustCover: true });
        }
        created.push({ id: o.id, number: o.order_number, type, points });
      }
      await client.query("COMMIT");
      send(res, { orders: created, balance: await balanceOf(pool, access.employeeId) });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      fail(res, 400, (err as Error).message);
    } finally {
      client.release();
    }
  });

  app.get("/api/shop/points", async (req, res) => {
    try {
      const access = await me(req, res);
      if (!access) return;
      const db = getProductDb();
      const history = (await db.query(
        `SELECT t.id, t.amount, t.kind, t.reason, t.created_at, coalesce(c.first_name || ' ' || c.last_name, 'Automatic') AS by
           FROM employee_hub.point_transactions t LEFT JOIN employee_hub.employees c ON c.id = t.created_by_id
          WHERE t.employee_id = $1 ORDER BY t.created_at DESC LIMIT 200`, [access.employeeId])).rows;
      send(res, { balance: await balanceOf(db, access.employeeId), history });
    } catch (err) {
      fail(res, 500, `Could not load your points: ${(err as Error).message}`);
    }
  });

  // ---- Shop Admin -------------------------------------------------------------------------------

  app.get("/api/shop/admin/orders", async (req, res) => {
    try {
      const access = await me(req, res, "shop.admin");
      if (!access) return;
      const view = String(req.query.view ?? "open");
      const where = view === "archived" ? "o.archived_at IS NOT NULL" : view === "all" ? "TRUE" : "o.archived_at IS NULL AND o.status NOT IN ('received', 'cancelled')";
      const { rows } = await getProductDb().query(
        `SELECT ${ORDER_COLUMNS} FROM employee_hub.orders o WHERE o.company_id = $1 AND ${where} ORDER BY o.ordered_at DESC LIMIT 500`, [access.companyId]);
      send(res, withStatusName(rows));
    } catch (err) {
      fail(res, 500, `Could not load orders: ${(err as Error).message}`);
    }
  });

  const loadOrder = async (db: pg.PoolClient, id: string, companyId: string) => {
    if (!UUID.test(id)) return null;
    return (await db.query("SELECT * FROM employee_hub.orders WHERE id = $1 AND company_id = $2 FOR UPDATE", [id, companyId])).rows[0] ?? null;
  };

  app.post("/api/shop/admin/orders/:id/confirm", async (req, res) => {
    const client = await getProductDb().connect();
    try {
      const access = await me(req, res, "shop.admin");
      if (!access) return;
      await client.query("BEGIN");
      const order = await loadOrder(client, req.params.id, access.companyId);
      if (!order) throw new Error("Order not found.");
      if (order.status === "cancelled") throw new Error("This order was cancelled.");
      const items = (await client.query("SELECT * FROM employee_hub.order_items WHERE order_id = $1", [order.id])).rows;
      const prices = new Map<string, number>((Array.isArray(req.body?.lines) ? req.body.lines : []).map((l: { id: string; price: unknown }) => [l.id, Number(l.price)]));
      let total = 0;
      for (const it of items) {
        const typed = prices.has(it.id) ? prices.get(it.id)! : order.order_type === "sanmar" ? Number(it.branding?.clothingPrice ?? it.unit_price) : Number(it.unit_price);
        if (!Number.isFinite(typed) || typed < 0) throw new Error(`Enter a valid price for ${it.name || "every line"}.`);
        const p = priceLine({ source: order.order_type, quantity: it.quantity, clothingPrice: typed, unitPrice: typed,
          logo: it.branding?.logo, isHat: it.branding?.isHat, logoPlacement: it.branding?.placement }) as { unitPrice: number; total: number };
        total += p.total;
        await client.query("UPDATE employee_hub.order_items SET unit_price = $2, line_total = $3, branding = branding || $4 WHERE id = $1",
          [it.id, p.unitPrice, p.total, JSON.stringify(order.order_type === "sanmar" ? { clothingPrice: typed } : {})]);
      }
      const confirmed = Math.round(total);
      const delta = confirmed - order.points_charged;
      if (delta !== 0 && order.employee_id && !order.is_stock_order) {
        await post(client, { companyId: access.companyId, employeeId: order.employee_id, amount: -delta, kind: "order_settle",
          reason: `Order #${order.order_number ?? order.legacy_number}: confirmed price ${delta > 0 ? "higher" : "lower"} than the estimate`,
          orderId: order.id, createdById: access.employeeId });
      }
      await client.query(
        `UPDATE employee_hub.orders SET points_charged = $2, pricing_confirmed = true,
           status = CASE WHEN status = 'pending_pricing' THEN 'ready_to_order' ELSE status END, updated_at = now() WHERE id = $1`,
        [order.id, order.is_stock_order ? 0 : confirmed]);
      await client.query("COMMIT");
      send(res, { pointsCharged: confirmed, difference: delta });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      fail(res, 400, (err as Error).message);
    } finally {
      client.release();
    }
  });

  app.patch("/api/shop/admin/orders/:id", async (req, res) => {
    const client = await getProductDb().connect();
    try {
      const access = await me(req, res, "shop.admin");
      if (!access) return;
      await client.query("BEGIN");
      const order = await loadOrder(client, req.params.id, access.companyId);
      if (!order) throw new Error("Order not found.");
      const b = req.body ?? {};
      if (b.status !== undefined) {
        const key = STATUS_KEY[b.status] ?? b.status;
        if (!ADMIN_SETTABLE.includes(key)) throw new Error("Use Cancel to cancel an order (it refunds the points).");
        if (order.status === "cancelled") throw new Error("This order was cancelled.");
        if (key !== "pending_pricing" && order.status === "pending_pricing" && !order.pricing_confirmed) throw new Error("Confirm the prices first.");
        await client.query("UPDATE employee_hub.orders SET status = $2, updated_at = now() WHERE id = $1", [order.id, key]);
      }
      if (typeof b.adminNotes === "string") await client.query("UPDATE employee_hub.orders SET admin_notes = $2, updated_at = now() WHERE id = $1", [order.id, b.adminNotes.slice(0, 2000)]);
      if (b.estDelivery !== undefined) {
        if (b.estDelivery && !/^\d{4}-\d{2}-\d{2}$/.test(b.estDelivery)) throw new Error("Estimated delivery must be a date.");
        await client.query("UPDATE employee_hub.orders SET est_delivery = $2, updated_at = now() WHERE id = $1", [order.id, b.estDelivery || null]);
      }
      if (typeof b.archived === "boolean") await client.query("UPDATE employee_hub.orders SET archived_at = CASE WHEN $2 THEN now() END, updated_at = now() WHERE id = $1", [order.id, b.archived]);
      await client.query("COMMIT");
      send(res, { id: order.id });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      fail(res, 400, (err as Error).message);
    } finally {
      client.release();
    }
  });

  app.post("/api/shop/admin/orders/:id/cancel", async (req, res) => {
    const client = await getProductDb().connect();
    try {
      const access = await me(req, res, "shop.admin");
      if (!access) return;
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return void fail(res, 400, "Give a reason for cancelling.");
      await client.query("BEGIN");
      const order = await loadOrder(client, req.params.id, access.companyId);
      if (!order) throw new Error("Order not found.");
      if (order.status === "cancelled") throw new Error("Already cancelled.");
      if (order.points_charged > 0 && order.employee_id && !order.legacy_source) {
        await post(client, { companyId: access.companyId, employeeId: order.employee_id, amount: order.points_charged, kind: "order_refund",
          reason: `Order #${order.order_number} cancelled: ${reason}`, orderId: order.id, createdById: access.employeeId });
      }
      await client.query("UPDATE employee_hub.orders SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now() WHERE id = $1", [order.id, reason]);
      await client.query("COMMIT");
      send(res, { refunded: order.legacy_source ? 0 : order.points_charged });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      fail(res, 400, (err as Error).message);
    } finally {
      client.release();
    }
  });

  app.post("/api/shop/admin/stock-order", async (req, res) => {
    const client = await getProductDb().connect();
    try {
      const access = await me(req, res, "shop.admin");
      if (!access) return;
      const priced = await priceCart(client, req.body?.lines);
      await client.query("BEGIN");
      const byType = new Map<string, typeof priced>();
      for (const x of priced) byType.set(x.line.source, [...(byType.get(x.line.source) ?? []), x]);
      const created: number[] = [];
      for (const [type, lines] of byType) {
        const o = (await client.query(
          `INSERT INTO employee_hub.orders (company_id, order_type, employee_id, customer_name, status, is_stock_order, points_charged, pricing_confirmed)
           VALUES ($1,$2,NULL,'Stock order',$3,true,0,$4) RETURNING id, order_number`,
          [access.companyId, type, needsPricingConfirmation(type) ? "pending_pricing" : "ready_to_order", !needsPricingConfirmation(type)])).rows[0];
        for (const x of lines) {
          const r = itemRow(x.line, x.priced);
          await client.query(
            `INSERT INTO employee_hub.order_items (order_id, catalog_item_id, name, sku, link, quantity, unit_price, line_total, options, branding)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [o.id, r.catalogItemId, r.name, r.sku, r.link, x.priced.quantity, x.priced.unitPrice, x.priced.total, JSON.stringify(r.options), JSON.stringify(r.branding)]);
        }
        created.push(o.order_number);
      }
      await client.query("COMMIT");
      send(res, { orderNumbers: created });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      fail(res, 400, (err as Error).message);
    } finally {
      client.release();
    }
  });

  app.get("/api/shop/admin/catalog", async (req, res) => {
    try {
      const access = await me(req, res, "shop.admin");
      if (!access) return;
      send(res, (await getProductDb().query("SELECT id, name, price::float AS price, image_upload_id, options, is_visible FROM employee_hub.catalog_items ORDER BY name")).rows);
    } catch (err) {
      fail(res, 500, (err as Error).message);
    }
  });

  const catalogFields = (b: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    if (b.name !== undefined) { const n = String(b.name).trim(); if (!n) throw new Error("Give the item a name."); out.name = n.slice(0, 200); }
    if (b.price !== undefined) { const p = Number(b.price); if (!Number.isFinite(p) || p < 0) throw new Error("Enter a valid price."); out.price = Math.round(p * 100) / 100; }
    if (b.imageUploadId !== undefined) out.image_upload_id = b.imageUploadId && UUID.test(String(b.imageUploadId)) ? b.imageUploadId : null;
    if (b.isVisible !== undefined) out.is_visible = !!b.isVisible;
    if (b.options !== undefined) {
      if (!Array.isArray(b.options)) throw new Error("Options must be a list.");
      out.options = JSON.stringify(b.options.map((o: { label?: unknown; choices?: unknown }) => ({
        label: String(o?.label ?? "").trim(), choices: (Array.isArray(o?.choices) ? o.choices : []).map((c) => String(c).trim()).filter(Boolean),
      })).filter((o: { label: string; choices: string[] }) => o.label && o.choices.length));
    }
    return out;
  };

  app.post("/api/shop/admin/catalog", async (req, res) => {
    try {
      const access = await me(req, res, "shop.admin");
      if (!access) return;
      const f = catalogFields(req.body ?? {});
      if (!f.name || f.price === undefined) return void fail(res, 400, "Name and price are required.");
      const cols = Object.keys(f);
      const { rows } = await getProductDb().query(
        `INSERT INTO employee_hub.catalog_items (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, cols.map((c) => f[c]));
      send(res, { id: rows[0].id });
    } catch (err) {
      fail(res, 400, (err as Error).message);
    }
  });

  app.patch("/api/shop/admin/catalog/:id", async (req, res) => {
    try {
      const access = await me(req, res, "shop.admin");
      if (!access) return;
      if (!UUID.test(req.params.id)) return void fail(res, 404, "Not found");
      const f = catalogFields(req.body ?? {});
      const cols = Object.keys(f);
      if (!cols.length) return void send(res, { id: req.params.id });
      await getProductDb().query(`UPDATE employee_hub.catalog_items SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
        [req.params.id, ...cols.map((c) => f[c])]);
      send(res, { id: req.params.id });
    } catch (err) {
      fail(res, 400, (err as Error).message);
    }
  });

  // ---- Points (Shop Admins) ---------------------------------------------------------------------

  app.get("/api/points/admin", async (req, res) => {
    try {
      const access = await me(req, res, "points.manage");
      if (!access) return;
      const { rows } = await getProductDb().query(
        `SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.birthday_md, e.hired_on::text AS hired_on,
                coalesce((SELECT sum(amount) FROM employee_hub.point_transactions t WHERE t.employee_id = e.id), 0)::int AS balance
           FROM employee_hub.employees e WHERE e.company_id = $1 AND e.is_active ORDER BY e.last_name, e.first_name`, [access.companyId]);
      send(res, rows);
    } catch (err) {
      fail(res, 500, (err as Error).message);
    }
  });

  app.get("/api/points/admin/rules", async (req, res) => {
    try {
      const access = await me(req, res, "points.manage");
      if (!access) return;
      const { rows } = await getProductDb().query(
        `SELECT r.id, r.name, r.trigger, r.amount, r.is_active, r.effective_from::text AS effective_from,
                (SELECT count(*)::int FROM employee_hub.point_rule_awards a WHERE a.rule_id = r.id) AS times_paid
           FROM employee_hub.point_rules r WHERE r.company_id = $1 ORDER BY r.created_at`, [access.companyId]);
      send(res, rows);
    } catch (err) {
      fail(res, 500, (err as Error).message);
    }
  });

  app.get("/api/points/admin/:employeeId", async (req, res) => {
    try {
      const access = await me(req, res, "points.manage");
      if (!access) return;
      if (!UUID.test(req.params.employeeId)) return void fail(res, 404, "Not found");
      const db = getProductDb();
      const emp = (await db.query("SELECT company_id FROM employee_hub.employees WHERE id = $1", [req.params.employeeId])).rows[0];
      if (!emp || emp.company_id !== access.companyId) return void fail(res, 404, "Not found");
      const history = (await db.query(
        `SELECT t.id, t.amount, t.kind, t.reason, t.created_at, coalesce(c.first_name || ' ' || c.last_name, 'Automatic') AS by
           FROM employee_hub.point_transactions t LEFT JOIN employee_hub.employees c ON c.id = t.created_by_id
          WHERE t.employee_id = $1 ORDER BY t.created_at DESC`, [req.params.employeeId])).rows;
      send(res, { balance: await balanceOf(db, req.params.employeeId), history });
    } catch (err) {
      fail(res, 500, (err as Error).message);
    }
  });

  app.post("/api/points/admin/adjust", async (req, res) => {
    const client = await getProductDb().connect();
    try {
      const access = await me(req, res, "points.manage");
      if (!access) return;
      const amount = Number(req.body?.amount);
      const reason = String(req.body?.reason ?? "").trim();
      if (!Number.isInteger(amount) || amount === 0) return void fail(res, 400, "Enter a whole number of points (negative to deduct).");
      if (!reason) return void fail(res, 400, "A reason is required.");
      const emp = (await client.query("SELECT company_id FROM employee_hub.employees WHERE id = $1", [req.body?.employeeId])).rows[0];
      if (!emp || emp.company_id !== access.companyId) return void fail(res, 404, "Employee not found.");
      await client.query("BEGIN");
      const t = await post(client, { companyId: access.companyId, employeeId: req.body.employeeId, amount, kind: "grant", reason, createdById: access.employeeId });
      await client.query("COMMIT");
      send(res, { balance: t.balance });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      fail(res, 400, (err as Error).message);
    } finally {
      client.release();
    }
  });

  const RULE_TRIGGERS = ["birthday", "on_hire", "hire_anniversary", "monthly"];
  app.post("/api/points/admin/rules", async (req, res) => {
    try {
      const access = await me(req, res, "points.manage");
      if (!access) return;
      const b = req.body ?? {};
      if (!RULE_TRIGGERS.includes(b.trigger)) return void fail(res, 400, "Pick when the rule pays out.");
      const amount = b.amount === "" || b.amount == null ? null : Number(b.amount);
      if (amount !== null && (!Number.isInteger(amount) || amount <= 0)) return void fail(res, 400, "Points must be a positive whole number.");
      const name = String(b.name ?? "").trim() || b.trigger;
      const { rows } = await getProductDb().query(
        `INSERT INTO employee_hub.point_rules (company_id, name, trigger, amount, effective_from, created_by_id)
         VALUES ($1,$2,$3,$4,CASE WHEN $4::int IS NOT NULL THEN $5::date END,$6) RETURNING id`,
        [access.companyId, name.slice(0, 80), b.trigger, amount, localDate(new Date()), access.employeeId]);
      send(res, { id: rows[0].id });
    } catch (err) {
      fail(res, 500, (err as Error).message);
    }
  });

  app.patch("/api/points/admin/rules/:id", async (req, res) => {
    try {
      const access = await me(req, res, "points.manage");
      if (!access) return;
      if (!UUID.test(req.params.id)) return void fail(res, 404, "Not found");
      const db = getProductDb();
      const rule = (await db.query("SELECT * FROM employee_hub.point_rules WHERE id = $1 AND company_id = $2", [req.params.id, access.companyId])).rows[0];
      if (!rule) return void fail(res, 404, "Not found");
      const b = req.body ?? {};
      const amount = b.amount === undefined ? rule.amount : b.amount === "" || b.amount === null ? null : Number(b.amount);
      if (amount !== null && (!Number.isInteger(amount) || amount <= 0)) return void fail(res, 400, "Points must be a positive whole number.");
      const isActive = typeof b.isActive === "boolean" ? b.isActive : rule.is_active;
      const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 80) : rule.name;
      // Turning payouts on (blank → amount) starts the rule from today: no back-pay for on-hire.
      const effective = amount === null ? null : rule.effective_from ?? localDate(new Date());
      await db.query("UPDATE employee_hub.point_rules SET name = $2, amount = $3, is_active = $4, effective_from = $5, updated_at = now() WHERE id = $1",
        [rule.id, name, amount, isActive, effective]);
      send(res, { id: rule.id });
    } catch (err) {
      fail(res, 500, (err as Error).message);
    }
  });
}
