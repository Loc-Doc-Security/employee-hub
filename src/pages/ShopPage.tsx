// Shop: uniform catalog, SanMar and Amazon items, cart, my orders, my points.
// Prices shown here are a preview; the server re-prices every line from the same rules (and the
// catalog) when the cart is quoted or placed. Shop Admins also get "place as stock order".
import { useEffect, useMemo, useState } from "react";
import { hubGet, hubPost, useUploadUrl } from "../lib/hubApi";
import PageTitle from "../components/PageTitle";

type CatalogItem = { id: string; name: string; price: number; image_upload_id: string | null; options: { label: string; choices: string[] }[] };
type OrderItem = { id: string; name: string; sku: string; link: string | null; quantity: number; unitPrice: number; total: number; options: Record<string, string>; branding?: { clothingPrice?: number } };
type Order = { id: string; order_number: number | null; legacy_number: string | null; order_type: string; statusName: string; status: string;
  points_charged: number; ordered_at: string; est_delivery: string | null; cancel_reason: string | null; items: OrderItem[]; archived_at: string | null };
type Init = { catalog: CatalogItem[]; balance: number; allowedTypes: string[]; orders: Order[]; isShopAdmin: boolean; canNoLogo: boolean };
type Line = Record<string, unknown> & { source: "uniform" | "sanmar" | "amazon"; key: string; label: string };

export const LOGOS = ["Target", "Stacked", "The Lab", "OMS"];
export const LOGO_COLORS = ["White", "Black", "Green", "Grey", "Tone on Tone"];
export const HAT_PLACEMENTS = ["Front", "Front Center", "Left Side", "Right Side", "Back"];
const TYPE_LABEL: Record<string, string> = { uniform: "Uniform", sanmar: "SanMar", amazon: "Amazon" };
const CART_KEY = "employee-hub:cart";
const field = "w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm";
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function CatalogPhoto({ id, alt }: { id: string | null; alt: string }) {
  const url = useUploadUrl(id);
  return url ? <img src={url} alt={alt} className="h-40 w-full rounded-xl object-cover" /> : <div className="h-40 rounded-xl bg-slate-800/70" />;
}

function UniformCard({ item, onAdd }: { item: CatalogItem; onAdd: (l: Line) => void }) {
  const [opts, setOpts] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const ready = item.options.every((o) => opts[o.label]);
  return (
    <div className="glass-card rounded-2xl p-4 space-y-2">
      <CatalogPhoto id={item.image_upload_id} alt={item.name} />
      <div className="flex justify-between gap-2"><span className="font-semibold">{item.name}</span><span className="font-semibold">{item.price} pts</span></div>
      {item.options.map((o) => (
        <select key={o.label} className={field} value={opts[o.label] ?? ""} onChange={(e) => setOpts({ ...opts, [o.label]: e.target.value })}>
          <option value="">{o.label}…</option>{o.choices.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      ))}
      <div className="flex gap-2">
        <input type="number" min={1} className={`${field} w-20`} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
        <button type="button" className="btn-brand flex-1" disabled={!ready}
          onClick={() => { onAdd({ source: "uniform", key: crypto.randomUUID(), label: `${item.name}${Object.values(opts).length ? ` (${Object.values(opts).join(", ")})` : ""}`, productId: item.id, selectedOptions: opts, quantity: qty }); setOpts({}); setQty(1); }}>
          {ready ? "Add to cart" : "Choose options"}
        </button>
      </div>
    </div>
  );
}

function SanmarForm({ canNoLogo, onAdd }: { canNoLogo: boolean; onAdd: (l: Line) => void }) {
  const blank = { itemNumber: "", clothingPrice: "", quantity: "1", color: "", size: "", isHat: false, isPants: false, hatSize: "", pantSize: "", inseam: "", logo: "", logoColor: "", logoPlacement: "" };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  return (
    <div className="glass-card rounded-2xl p-5 space-y-3">
      <div className="font-semibold">SanMar item</div>
      <p className="text-xs text-slate-500">Your price is an estimate: a Shop Admin confirms the real price and any difference is charged or refunded.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        <input className={field} placeholder="Item number" value={f.itemNumber} onChange={set("itemNumber")} />
        <input className={field} placeholder="Clothing price ($)" inputMode="decimal" value={f.clothingPrice} onChange={set("clothingPrice")} />
        <input className={field} placeholder="Quantity" inputMode="numeric" value={f.quantity} onChange={set("quantity")} />
        <input className={field} placeholder="Color" value={f.color} onChange={set("color")} />
      </div>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.isHat} onChange={(e) => setF({ ...f, isHat: e.target.checked, isPants: false })} /> Hat</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.isPants} onChange={(e) => setF({ ...f, isPants: e.target.checked, isHat: false })} /> Pants</label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        {f.isHat ? <input className={field} placeholder="Hat size" value={f.hatSize} onChange={set("hatSize")} />
          : f.isPants ? <><input className={field} placeholder="Pant size" value={f.pantSize} onChange={set("pantSize")} /><input className={field} placeholder="Inseam" value={f.inseam} onChange={set("inseam")} /></>
          : <input className={field} placeholder="Size" value={f.size} onChange={set("size")} />}
        <select className={field} value={f.logo} onChange={set("logo")}><option value="">Logo…</option>{(canNoLogo ? ["None", ...LOGOS] : LOGOS).map((l) => <option key={l}>{l}</option>)}</select>
        {f.logo && f.logo !== "None" && <select className={field} value={f.logoColor} onChange={set("logoColor")}><option value="">Logo color…</option>{LOGO_COLORS.map((c) => <option key={c}>{c}</option>)}</select>}
        {f.isHat && f.logo && f.logo !== "None" && <select className={field} value={f.logoPlacement} onChange={set("logoPlacement")}><option value="">Placement…</option>{HAT_PLACEMENTS.map((p) => <option key={p}>{p}</option>)}</select>}
      </div>
      <button type="button" className="btn-brand" disabled={!f.itemNumber || !f.clothingPrice}
        onClick={() => { onAdd({ source: "sanmar", key: crypto.randomUUID(), label: `SanMar ${f.itemNumber} (${[f.color, f.size || f.hatSize || f.pantSize, f.logo].filter(Boolean).join(", ")})`, ...f, quantity: Number(f.quantity) || 1 }); setF(blank); }}>
        Add to cart
      </button>
    </div>
  );
}

function AmazonForm({ onAdd }: { onAdd: (l: Line) => void }) {
  const blank = { name: "", link: "", unitPrice: "", quantity: "1", size: "", color: "", width: "" };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="glass-card rounded-2xl p-5 space-y-3">
      <div className="font-semibold">Amazon item</div>
      <p className="text-xs text-slate-500">Paste the product link. Your price is an estimate until a Shop Admin confirms it.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
        <input className={field} placeholder="What is it? (e.g. work boots)" value={f.name} onChange={set("name")} />
        <input className={field} placeholder="https://www.amazon.com/…" value={f.link} onChange={set("link")} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
        <input className={field} placeholder="Price ($)" inputMode="decimal" value={f.unitPrice} onChange={set("unitPrice")} />
        <input className={field} placeholder="Quantity" inputMode="numeric" value={f.quantity} onChange={set("quantity")} />
        <input className={field} placeholder="Size" value={f.size} onChange={set("size")} />
        <input className={field} placeholder="Color" value={f.color} onChange={set("color")} />
        <input className={field} placeholder="Width" value={f.width} onChange={set("width")} />
      </div>
      <button type="button" className="btn-brand" disabled={!f.link || !f.unitPrice}
        onClick={() => { onAdd({ source: "amazon", key: crypto.randomUUID(), label: `Amazon: ${f.name || "item"}`, ...f, quantity: Number(f.quantity) || 1 }); setF(blank); }}>
        Add to cart
      </button>
    </div>
  );
}

export function OrderCard({ o, admin }: { o: Order; admin?: React.ReactNode }) {
  return (
    <div className="glass-card rounded-2xl p-5 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="font-semibold">#{o.order_number ?? o.legacy_number ?? "—"} · {TYPE_LABEL[o.order_type]} <span className="text-sm font-normal text-slate-500">· {fmtDate(o.ordered_at)}</span></div>
        <div className="text-sm"><span className="rounded-full border border-slate-600 px-3 py-1">{o.statusName}</span> <span className="ml-2 font-semibold">{o.points_charged} pts</span></div>
      </div>
      {o.items.map((i) => (
        <div key={i.id} className="flex justify-between gap-3 text-sm">
          <span>{i.quantity}× {i.name || i.sku || "Item"}{Object.values(i.options ?? {}).length ? <span className="text-slate-500"> · {Object.entries(i.options).map(([k, v]) => `${k}: ${v}`).join(", ")}</span> : null}
            {i.link && <> · <a className="btn-text" href={i.link} target="_blank" rel="noreferrer">link ↗</a></>}</span>
          <span className="text-slate-500">{i.total}</span>
        </div>
      ))}
      {o.est_delivery && <div className="text-xs text-slate-500">Estimated delivery {fmtDate(`${o.est_delivery}T12:00:00`)}</div>}
      {o.cancel_reason && <div className="text-xs text-slate-500">Cancelled: {o.cancel_reason}</div>}
      {admin}
    </div>
  );
}

export default function ShopPage() {
  const [data, setData] = useState<Init | null>(null);
  const [tab, setTab] = useState<"shop" | "cart" | "orders" | "points">("shop");
  const [cart, setCart] = useState<Line[]>(() => { try { return JSON.parse(localStorage.getItem(CART_KEY) ?? "[]"); } catch { return []; } });
  const [quote, setQuote] = useState<{ lines: { total: number }[]; total: number; points: number; balance: number } | null>(null);
  const [stock, setStock] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [points, setPoints] = useState<{ balance: number; history: { id: string; amount: number; reason: string; created_at: string; by: string }[] } | null>(null);

  const load = () => hubGet<Init>("/api/shop/init").then(setData).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  useEffect(() => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* storage blocked */ } }, [cart]);
  useEffect(() => {
    if (!cart.length) return setQuote(null);
    hubPost<typeof quote>("/api/shop/quote", { lines: cart }).then((q) => { setQuote(q); setError(""); }).catch((e: Error) => { setQuote(null); setError(e.message); });
  }, [cart]);
  useEffect(() => { if (tab === "points") hubGet<typeof points>("/api/shop/points").then(setPoints).catch(() => setPoints(null)); }, [tab]);

  const add = (l: Line) => { setCart((c) => [...c, l]); setMessage(`Added ${l.label}.`); };
  const place = async () => {
    setPlacing(true); setError("");
    try {
      if (stock) {
        const r = await hubPost<{ orderNumbers: number[] }>("/api/shop/admin/stock-order", { lines: cart });
        setMessage(`Stock order${r.orderNumbers.length > 1 ? "s" : ""} #${r.orderNumbers.join(", #")} placed.`);
      } else {
        const r = await hubPost<{ orders: { number: number; type: string }[]; balance: number }>("/api/shop/orders", { lines: cart });
        setMessage(`Order${r.orders.length > 1 ? "s" : ""} ${r.orders.map((o) => `#${o.number} (${TYPE_LABEL[o.type]})`).join(", ")} placed. Balance: ${r.balance} points.`);
      }
      setCart([]); setStock(false); setTab("orders"); await load();
    } catch (e) { setError((e as Error).message); } finally { setPlacing(false); }
  };

  const active = useMemo(() => (data?.orders ?? []).filter((o) => !o.archived_at), [data]);
  if (error && !data) return <div className="glass-card rounded-2xl p-6 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  const tabs: [typeof tab, string][] = [["shop", "Shop"], ["cart", `Cart${cart.length ? ` (${cart.length})` : ""}`], ["orders", "My orders"], ["points", "My points"]];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <PageTitle title="Shop" />
        <div className="text-sm">Balance <span className="text-2xl font-black">{data.balance}</span> points</div>
      </div>
      <div className="flex gap-2 flex-wrap" role="tablist">
        {tabs.map(([k, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${tab === k ? "btn-brand" : "border-slate-700 bg-slate-900/70"}`}>{n}</button>
        ))}
      </div>
      {message && <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-slate-200">{message}</div>}

      {tab === "shop" && (
        <div className="space-y-6">
          {data.allowedTypes.includes("uniform") && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{data.catalog.map((c) => <UniformCard key={c.id} item={c} onAdd={add} />)}</div>
          )}
          {data.allowedTypes.includes("sanmar") && <SanmarForm canNoLogo={data.canNoLogo} onAdd={add} />}
          {data.allowedTypes.includes("amazon") && <AmazonForm onAdd={add} />}
          {!data.allowedTypes.length && <div className="text-sm text-slate-500">Ordering isn't turned on for your account.</div>}
        </div>
      )}

      {tab === "cart" && (
        <div className="glass-card rounded-2xl p-6 space-y-3">
          {!cart.length && <div className="text-sm text-slate-500">Your cart is empty.</div>}
          {cart.map((l, i) => (
            <div key={l.key} className="flex items-center justify-between gap-3 text-sm">
              <span>{String(l.quantity)}× {l.label}</span>
              <span className="flex items-center gap-3"><span className="font-semibold">{quote?.lines[i]?.total ?? "…"}</span>
                <button type="button" className="btn-text" onClick={() => setCart(cart.filter((x) => x.key !== l.key))}>Remove</button></span>
            </div>
          ))}
          {error && <div className="text-sm text-red-700">{error}</div>}
          {quote && (
            <div className="border-t border-slate-700 pt-3 space-y-3">
              <div className="flex justify-between font-semibold"><span>Total</span><span>{quote.points} points</span></div>
              {!stock && quote.points > quote.balance && <div className="text-sm text-red-700">That's more than your {quote.balance} points.</div>}
              {data.isShopAdmin && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stock} onChange={(e) => setStock(e.target.checked)} /> Stock order for the shelf (no points charged)</label>}
              <button type="button" className="btn-brand" disabled={placing || (!stock && quote.points > quote.balance)} onClick={() => void place()}>
                {placing ? "Placing…" : stock ? "Place stock order" : `Place order (${quote.points} points)`}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "orders" && (
        <div className="space-y-3">
          {active.length === 0 && <div className="glass-card rounded-2xl p-6 text-sm text-slate-500">No orders yet.</div>}
          {active.map((o) => <OrderCard key={o.id} o={o} />)}
        </div>
      )}

      {tab === "points" && (
        <div className="glass-card rounded-2xl overflow-hidden">
          {!points ? <div className="p-4 text-sm text-slate-500">Loading…</div> : points.history.map((h) => (
            <div key={h.id} className="flex justify-between gap-3 border-t border-slate-800 px-4 py-3 text-sm first:border-t-0">
              <span>{h.reason || "—"} <span className="text-xs text-slate-500">· {fmtDate(h.created_at)}{h.by !== "Automatic" ? ` · ${h.by}` : ""}</span></span>
              <span className={`font-semibold ${h.amount > 0 ? "" : "text-slate-500"}`}>{h.amount > 0 ? "+" : ""}{h.amount}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
