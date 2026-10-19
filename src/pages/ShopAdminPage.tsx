// Shop Admin (Levi, David Snipes, Adam Svagr):
//   Orders   the queue: confirm SanMar/Amazon prices (the difference is charged or refunded), move
//            orders along, notes, estimated delivery, cancel (refunds), archive
//   Catalog  the shared uniform catalog: name, price, photo, options, show/hide
//   Points   everyone's balance; add or deduct with a reason; each person's history
//   Rules    automatic points (birthday, on hire, anniversary, monthly)
import { useEffect, useState } from "react";
import { hubGet, hubPatch, hubPost, hubUpload, shrinkImage, useUploadUrl } from "../lib/hubApi";
import { OrderCard } from "./ShopPage";

type Order = Parameters<typeof OrderCard>[0]["o"] & { customer_name: string; is_stock_order: boolean; pricing_confirmed: boolean; admin_notes: string;
  items: (Parameters<typeof OrderCard>[0]["o"]["items"][number] & { branding?: { clothingPrice?: number } })[] };
type CatalogItem = { id: string; name: string; price: number; image_upload_id: string | null; options: { label: string; choices: string[] }[]; is_visible: boolean };
type Rule = { id: string; name: string; trigger: string; amount: number | null; is_active: boolean; effective_from: string | null; times_paid: number };

const STATUSES = ["Pending Pricing", "Ready to Order", "Ordered", "Waiting - Bulk Order", "Partially Received", "Received", "Waiting for Pickup"];
const TRIGGERS: Record<string, string> = { birthday: "On their birthday (each year)", on_hire: "When hired (once)", hire_anniversary: "On their work anniversary (each year)", monthly: "Every month" };
const field = "w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm";

function OrderAdmin({ o, onChanged }: { o: Order; onChanged: () => void }) {
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(o.items.map((i) => [i.id, String(o.order_type === "sanmar" ? i.branding?.clothingPrice ?? i.unitPrice : i.unitPrice)])));
  const [notes, setNotes] = useState(o.admin_notes);
  const [eta, setEta] = useState(o.est_delivery ?? "");
  const [msg, setMsg] = useState("");
  const act = async (fn: () => Promise<unknown>, done: string) => { setMsg(""); try { await fn(); setMsg(done); onChanged(); } catch (e) { setMsg((e as Error).message); } };
  const pending = o.status === "pending_pricing";
  return (
    <div className="border-t border-slate-700 pt-3 space-y-3 text-sm">
      <div className="text-slate-400">{o.is_stock_order ? "Stock order" : o.customer_name}</div>
      {pending && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2 text-slate-200">
          <div className="font-semibold">Confirm prices{o.order_type === "sanmar" ? " (clothing price; logo fees are added automatically)" : ""}</div>
          {o.items.map((i) => (
            <label key={i.id} className="flex items-center justify-between gap-3">{i.name || "Item"} × {i.quantity}
              <input className="w-28 rounded-lg border border-slate-600 px-2 py-1" inputMode="decimal" value={prices[i.id]} onChange={(e) => setPrices({ ...prices, [i.id]: e.target.value })} /></label>
          ))}
          <button type="button" className="btn-brand" onClick={() => void act(async () => {
            const r = await hubPost<{ pointsCharged: number; difference: number }>(`/api/shop/admin/orders/${o.id}/confirm`, { lines: Object.entries(prices).map(([id, price]) => ({ id, price })) });
            setMsg(`Confirmed at ${r.pointsCharged} points (${r.difference > 0 ? `${r.difference} more charged` : r.difference < 0 ? `${-r.difference} refunded` : "no change"}).`);
          }, "")}>Confirm prices</button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <select className={field} value={o.statusName === "Cancelled" ? "" : o.statusName} disabled={o.status === "cancelled"}
          onChange={(e) => void act(() => hubPatch(`/api/shop/admin/orders/${o.id}`, { status: e.target.value }), "Status updated.")}>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <input type="date" className={field} value={eta} onChange={(e) => setEta(e.target.value)}
          onBlur={() => eta !== (o.est_delivery ?? "") && void act(() => hubPatch(`/api/shop/admin/orders/${o.id}`, { estDelivery: eta || null }), "Delivery date saved.")} />
        <input className={field} placeholder="Admin notes" value={notes} onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== o.admin_notes && void act(() => hubPatch(`/api/shop/admin/orders/${o.id}`, { adminNotes: notes }), "Notes saved.")} />
      </div>
      <div className="flex gap-2 flex-wrap">
        {o.status !== "cancelled" && (
          <button type="button" className="rounded-xl border border-red-300 px-3 py-1 text-red-700"
            onClick={() => { const reason = prompt(`Cancel order and refund ${o.points_charged} points? Reason:`); if (reason) void act(() => hubPost(`/api/shop/admin/orders/${o.id}/cancel`, { reason }), "Cancelled and refunded."); }}>Cancel & refund</button>
        )}
        <button type="button" className="rounded-xl border border-slate-600 px-3 py-1"
          onClick={() => void act(() => hubPatch(`/api/shop/admin/orders/${o.id}`, { archived: !o.archived_at }), o.archived_at ? "Unarchived." : "Archived.")}>{o.archived_at ? "Unarchive" : "Archive"}</button>
        {msg && <span className="self-center text-xs text-slate-500">{msg}</span>}
      </div>
    </div>
  );
}

function Orders() {
  const [view, setView] = useState("open");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [search, setSearch] = useState("");
  const load = () => hubGet<Order[]>(`/api/shop/admin/orders?view=${view}`).then(setOrders).catch(() => setOrders([]));
  useEffect(() => { void load(); }, [view]);
  const s = search.trim().toLowerCase();
  const shown = (orders ?? []).filter((o) => !s || `${o.customer_name} ${o.order_number ?? ""} ${o.legacy_number ?? ""}`.toLowerCase().includes(s));
  const pending = shown.filter((o) => o.status === "pending_pricing").length;
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {[["open", "Open"], ["archived", "Archived"], ["all", "All"]].map(([k, n]) => (
          <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}
            className={`rounded-xl border px-3 py-1 text-sm ${view === k ? "btn-brand" : "border-slate-700 bg-slate-900/70"}`}>{n}</button>
        ))}
        <input className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-1 text-sm" placeholder="Search name or order #" value={search} onChange={(e) => setSearch(e.target.value)} />
        {pending > 0 && <span className="self-center text-sm font-semibold">{pending} waiting for price confirmation</span>}
      </div>
      {!orders ? <div className="text-sm text-slate-500">Loading…</div> : shown.map((o) => <OrderCard key={`${o.id}-${o.status}-${o.points_charged}-${o.archived_at}`} o={o} admin={<OrderAdmin o={o} onChanged={() => void load()} />} />)}
      {orders && !shown.length && <div className="glass-card rounded-2xl p-6 text-sm text-slate-500">No orders here.</div>}
    </div>
  );
}

function CatalogEditor({ item, onDone }: { item: CatalogItem | null; onDone: () => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [price, setPrice] = useState(item ? String(item.price) : "");
  const [photo, setPhoto] = useState<string | null>(item?.image_upload_id ?? null);
  const [options, setOptions] = useState(item?.options.map((o) => ({ label: o.label, choices: o.choices.join(", ") })) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const photoUrl = useUploadUrl(photo);
  const save = async (extra: Record<string, unknown> = {}) => {
    setError("");
    const body = { name, price, imageUploadId: photo, options: options.map((o) => ({ label: o.label, choices: o.choices.split(",") })), ...extra };
    try { if (item) await hubPatch(`/api/shop/admin/catalog/${item.id}`, body); else await hubPost("/api/shop/admin/catalog", body); onDone(); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="glass-card rounded-2xl p-5 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-[10rem_1fr] gap-4">
        <label className="cursor-pointer">
          {photoUrl ? <img src={photoUrl} alt={name} className="h-40 w-full rounded-xl object-cover" /> : <div className="flex h-40 items-center justify-center rounded-xl bg-slate-800 text-xs text-slate-500">{busy ? "Uploading…" : "Add photo"}</div>}
          <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return; setBusy(true);
            try { setPhoto(await hubUpload(await shrinkImage(f).catch(() => f), "catalog")); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
          }} />
        </label>
        <div className="space-y-2">
          <input className={field} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={field} placeholder="Price (points)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          {options.map((o, i) => (
            <div key={i} className="grid grid-cols-[8rem_1fr_auto] gap-2">
              <input className={field} placeholder="Option (Size)" value={o.label} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <input className={field} placeholder="Choices, comma separated" value={o.choices} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, choices: e.target.value } : x)))} />
              <button type="button" className="btn-text" onClick={() => setOptions(options.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn-text" onClick={() => setOptions([...options, { label: "", choices: "" }])}>+ Add an option (size, color…)</button>
        </div>
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="flex gap-2 flex-wrap">
        <button type="button" className="btn-brand" disabled={busy} onClick={() => void save()}>{item ? "Save" : "Add item"}</button>
        <button type="button" className="rounded-xl border border-slate-600 px-4 py-2 text-sm" onClick={onDone}>Cancel</button>
        {item && <button type="button" className="ml-auto rounded-xl border border-slate-600 px-4 py-2 text-sm" onClick={() => void save({ isVisible: !item.is_visible })}>{item.is_visible ? "Hide from the shop" : "Show in the shop"}</button>}
      </div>
    </div>
  );
}

function Catalog() {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [editing, setEditing] = useState<CatalogItem | "new" | null>(null);
  const load = () => hubGet<CatalogItem[]>("/api/shop/admin/catalog").then(setItems).catch(() => setItems([]));
  useEffect(() => { void load(); }, []);
  if (editing) return <CatalogEditor key={editing === "new" ? "new" : editing.id} item={editing === "new" ? null : editing} onDone={() => { setEditing(null); void load(); }} />;
  return (
    <div className="space-y-3">
      <button type="button" className="btn-brand" onClick={() => setEditing("new")}>+ Add catalog item</button>
      <div className="glass-card rounded-2xl overflow-hidden">
        {(items ?? []).map((c) => (
          <button key={c.id} type="button" onClick={() => setEditing(c)} className="flex w-full justify-between gap-3 border-t border-slate-800 px-4 py-3 text-left text-sm first:border-t-0 hover:bg-slate-900/60">
            <span className="font-semibold">{c.name}{!c.is_visible && <span className="ml-2 text-xs font-normal text-slate-600">hidden</span>}</span>
            <span className="text-slate-500">{c.options.map((o) => o.label).join(", ") || "no options"} · {c.price} pts</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Points() {
  const [people, setPeople] = useState<{ id: string; name: string; balance: number }[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [history, setHistory] = useState<{ id: string; amount: number; reason: string; created_at: string; by: string }[]>([]);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");
  const load = () => hubGet<typeof people>("/api/points/admin").then(setPeople).catch(() => setPeople([]));
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (open) hubGet<{ history: typeof history }>(`/api/points/admin/${open}`).then((d) => setHistory(d.history)).catch(() => setHistory([])); }, [open, people]);
  const adjust = async () => {
    setMsg("");
    try {
      const r = await hubPost<{ balance: number }>("/api/points/admin/adjust", { employeeId: open, amount: Number(amount), reason });
      setMsg(`Done. New balance ${r.balance}.`); setAmount(""); setReason(""); await load();
    } catch (e) { setMsg((e as Error).message); }
  };
  const s = search.trim().toLowerCase();
  const person = people?.find((p) => p.id === open);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[22rem_1fr] gap-4">
      <div className="space-y-2">
        <input className={field} placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="glass-card rounded-2xl overflow-hidden max-h-[32rem] overflow-y-auto">
          {(people ?? []).filter((p) => !s || p.name.toLowerCase().includes(s)).map((p) => (
            <button key={p.id} type="button" onClick={() => { setOpen(p.id); setMsg(""); }}
              className={`flex w-full justify-between border-t border-slate-800 px-4 py-2 text-left text-sm first:border-t-0 ${open === p.id ? "bg-slate-800/80" : "hover:bg-slate-900/60"}`}>
              <span>{p.name}</span><span className="font-semibold">{p.balance}</span>
            </button>
          ))}
        </div>
      </div>
      {person ? (
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <div className="flex justify-between"><span className="text-xl font-semibold">{person.name}</span><span className="text-xl font-black">{person.balance} pts</span></div>
          <div className="grid grid-cols-1 md:grid-cols-[8rem_1fr_auto] gap-2">
            <input className={field} placeholder="+50 or -20" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <input className={field} placeholder="Reason (required, the employee sees it)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="button" className="btn-brand" disabled={!amount || !reason.trim()} onClick={() => void adjust()}>Apply</button>
          </div>
          {msg && <div className="text-xs text-slate-500">{msg}</div>}
          <div className="space-y-1">
            {history.map((h) => (
              <div key={h.id} className="flex justify-between gap-3 border-t border-slate-800 py-2 text-sm">
                <span>{h.reason || "—"} <span className="text-xs text-slate-500">· {new Date(h.created_at).toLocaleDateString()} · {h.by}</span></span>
                <span className="font-semibold">{h.amount > 0 ? "+" : ""}{h.amount}</span>
              </div>
            ))}
          </div>
        </div>
      ) : <div className="glass-card rounded-2xl p-6 text-sm text-slate-500">Pick someone to see their points or adjust them.</div>}
    </div>
  );
}

function Rules() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [draft, setDraft] = useState({ name: "", trigger: "hire_anniversary", amount: "" });
  const [msg, setMsg] = useState("");
  const load = () => hubGet<Rule[]>("/api/points/admin/rules").then(setRules).catch(() => setRules([]));
  useEffect(() => { void load(); }, []);
  const act = async (fn: () => Promise<unknown>, done: string) => { setMsg(""); try { await fn(); setMsg(done); await load(); } catch (e) { setMsg((e as Error).message); } };
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">Rules run automatically every hour. Each person is paid at most once per year (or month), and anything missed in the last week is caught up. "When hired" only pays people hired after its amount was set.</p>
      <div className="glass-card rounded-2xl overflow-hidden">
        {(rules ?? []).map((r) => (
          <div key={r.id} className="grid grid-cols-1 md:grid-cols-[1fr_9rem_auto] items-center gap-3 border-t border-slate-800 px-4 py-3 text-sm first:border-t-0">
            <div><div className="font-semibold">{r.name}{!r.is_active && <span className="ml-2 text-xs font-normal text-slate-600">off</span>}</div>
              <div className="text-xs text-slate-500">{TRIGGERS[r.trigger]} · paid {r.times_paid} time{r.times_paid === 1 ? "" : "s"}{r.amount == null ? " · no amount set, not paying" : ""}</div></div>
            <input className={field} placeholder="Points" defaultValue={r.amount ?? ""} inputMode="numeric"
              onBlur={(e) => e.target.value !== String(r.amount ?? "") && void act(() => hubPatch(`/api/points/admin/rules/${r.id}`, { amount: e.target.value }), "Saved.")} />
            <button type="button" className="btn-text" onClick={() => void act(() => hubPatch(`/api/points/admin/rules/${r.id}`, { isActive: !r.is_active }), r.is_active ? "Turned off." : "Turned on.")}>{r.is_active ? "Turn off" : "Turn on"}</button>
          </div>
        ))}
      </div>
      <div className="glass-card rounded-2xl p-5 space-y-2">
        <div className="font-semibold">Add a rule</div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_8rem_auto] gap-2">
          <input className={field} placeholder="Name (e.g. Work anniversary)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <select className={field} value={draft.trigger} onChange={(e) => setDraft({ ...draft, trigger: e.target.value })}>{Object.entries(TRIGGERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input className={field} placeholder="Points" inputMode="numeric" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
          <button type="button" className="btn-brand" onClick={() => void act(async () => { await hubPost("/api/points/admin/rules", draft); setDraft({ name: "", trigger: "hire_anniversary", amount: "" }); }, "Rule added.")}>Add</button>
        </div>
      </div>
      {msg && <div className="text-sm text-slate-400">{msg}</div>}
    </div>
  );
}

export default function ShopAdminPage() {
  const [tab, setTab] = useState<"orders" | "catalog" | "points" | "rules">("orders");
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Shop Admin</h1>
      <div className="flex gap-2 flex-wrap" role="tablist">
        {([["orders", "Orders"], ["catalog", "Catalog"], ["points", "Points"], ["rules", "Point rules"]] as const).map(([k, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${tab === k ? "btn-brand" : "border-slate-700 bg-slate-900/70"}`}>{n}</button>
        ))}
      </div>
      {tab === "orders" && <Orders />}
      {tab === "catalog" && <Catalog />}
      {tab === "points" && <Points />}
      {tab === "rules" && <Rules />}
    </div>
  );
}
