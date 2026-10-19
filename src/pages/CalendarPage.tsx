// Calendar: everything dated in one read-only place (Levi, 2026-10-19). Holidays and events are
// kept here by Calendar Admins (Manage tab); Wednesday meetings, PTO, birthdays and work
// anniversaries come from where they already live. Month view, plus an Upcoming list that reads
// better on a phone. Which kinds are shown is remembered in this browser.
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { hubDelete, hubGet, hubPost, hubPut } from "../lib/hubApi";
import PageTitle from "../components/PageTitle";

type Kind = "holiday" | "event" | "meeting" | "pto" | "birthday" | "anniversary";
type Item = { id: string; kind: Kind; title: string; start: string; end: string; time?: string | null; endTime?: string | null;
  detail?: string | null; location?: string | null; officeClosed?: boolean };

const KINDS: { kind: Kind; label: string; chip: string; dot: string }[] = [
  { kind: "holiday", label: "Holidays", chip: "bg-red-100 text-red-800", dot: "bg-red-500" },
  { kind: "event", label: "Events", chip: "bg-blue-100 text-blue-800", dot: "bg-blue-500" },
  { kind: "meeting", label: "Wednesday Meeting", chip: "bg-violet-100 text-violet-800", dot: "bg-violet-500" },
  { kind: "pto", label: "Who's out", chip: "bg-slate-700 text-slate-300", dot: "bg-slate-500" },
  { kind: "birthday", label: "Birthdays", chip: "bg-pink-100 text-pink-800", dot: "bg-pink-500" },
  { kind: "anniversary", label: "Work anniversaries", chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
];
const STYLE = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<Kind, (typeof KINDS)[number]>;
const SHOWN_KEY = "calendar.hidden";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const at = (s: string) => new Date(`${s}T12:00:00Z`);
const addDays = (s: string, n: number) => iso(new Date(at(s).getTime() + n * 864e5));
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtDay = (s: string) => at(s).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const fmtShort = (s: string) => at(s).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtTime = (t: string) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
const when = (i: Item) => [i.start === i.end ? null : `${fmtShort(i.start)} – ${fmtShort(i.end)}`, i.time ? `${fmtTime(i.time)}${i.endTime ? ` – ${fmtTime(i.endTime)}` : ""}` : null].filter(Boolean).join(" · ");

function useHidden() {
  const [hidden, setHidden] = useState<Set<Kind>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(SHOWN_KEY) ?? "[]") as Kind[]); } catch { return new Set(); }
  });
  const toggle = (k: Kind) => {
    const next = new Set(hidden);
    if (next.has(k)) next.delete(k); else next.add(k);
    setHidden(next);
    try { localStorage.setItem(SHOWN_KEY, JSON.stringify([...next])); } catch { /* not remembered */ }
  };
  return { hidden, toggle };
}

function useItems(from: string, to: string) {
  const [state, setState] = useState<{ items?: Item[]; canManage?: boolean; error?: string }>({});
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    hubGet<{ items: Item[]; canManage: boolean }>(`/api/calendar?from=${from}&to=${to}`)
      .then((d) => live && setState(d)).catch((e: Error) => live && setState({ error: e.message }));
    return () => { live = false; };
  }, [from, to, version]);
  return { ...state, reload: () => setVersion((v) => v + 1) };
}

function ItemLine({ i }: { i: Item }) {
  return (
    <div className="flex gap-3 py-2 border-t border-slate-800 first:border-t-0">
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${STYLE[i.kind].dot}`} />
      <div className="min-w-0 text-sm">
        <div className="font-semibold">{i.title}{i.officeClosed && <span className="ml-2 text-xs font-semibold text-red-700">Office closed</span>}</div>
        {when(i) && <div className="text-slate-500">{when(i)}</div>}
        {i.location && <div className="text-slate-500">{i.location}</div>}
        {i.detail && <div className="text-slate-400 whitespace-pre-line">{i.detail}</div>}
      </div>
    </div>
  );
}

/** One day's chips in the month grid. Several people out collapse into one "N out" chip. */
function DayChips({ items }: { items: Item[] }) {
  const out = items.filter((i) => i.kind === "pto");
  const rest = items.filter((i) => i.kind !== "pto");
  const chips = [...rest.map((i) => ({ key: i.id, cls: STYLE[i.kind].chip, text: i.title })),
    ...(out.length ? [{ key: "pto", cls: STYLE.pto.chip, text: out.length === 1 ? out[0].title : `${out.length} out` }] : [])];
  return (
    <div className="space-y-0.5">
      {chips.slice(0, 3).map((c) => <div key={c.key} className={`truncate rounded px-1 text-[11px] leading-4 ${c.cls}`}>{c.text}</div>)}
      {chips.length > 3 && <div className="text-[11px] text-slate-500">+{chips.length - 3} more</div>}
    </div>
  );
}

function MonthView({ hidden }: { hidden: Set<Kind> }) {
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [selected, setSelected] = useState(todayLocal());
  const first = `${month}-01`;
  const gridStart = addDays(first, -at(first).getUTCDay());
  const gridEnd = addDays(gridStart, 41);
  const { items, error } = useItems(gridStart, gridEnd);
  const shown = (items ?? []).filter((i) => !hidden.has(i.kind));
  const on = (d: string) => shown.filter((i) => i.start <= d && i.end >= d);
  const shift = (n: number) => { const d = at(first); d.setUTCMonth(d.getUTCMonth() + n); setMonth(iso(d).slice(0, 7)); };
  const today = todayLocal();
  const days = Array.from({ length: 42 }, (_, n) => addDays(gridStart, n));
  const weeks = days[35].slice(0, 7) === month ? 6 : 5;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" className="rounded-lg border border-slate-700 p-1.5" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="w-4 h-4" /></button>
        <h2 className="text-xl font-semibold min-w-[11rem] text-center">{at(first).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
        <button type="button" className="rounded-lg border border-slate-700 p-1.5" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="w-4 h-4" /></button>
        <button type="button" className="btn-text text-sm" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>Today</button>
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="grid grid-cols-7 text-xs text-slate-500 border-b border-slate-700">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="p-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.slice(0, weeks * 7).map((d) => (
            <button key={d} type="button" onClick={() => setSelected(d)}
              className={`min-h-[5.5rem] border-b border-r border-slate-800 p-1 text-left align-top ${d.slice(0, 7) !== month ? "bg-slate-900/60 text-slate-600" : ""} ${selected === d ? "ring-2 ring-inset ring-[var(--theme-accent-500,#3b82f6)]" : ""}`}>
              <div className={`mb-0.5 text-xs font-semibold ${d === today ? "hub-today" : ""}`}>{Number(d.slice(8))}</div>
              <DayChips items={on(d)} />
            </button>
          ))}
        </div>
      </div>
      <div className="glass-card rounded-2xl p-4">
        <div className="font-semibold">{fmtDay(selected)}</div>
        {on(selected).length ? on(selected).map((i) => <ItemLine key={i.id} i={i} />) : <div className="text-sm text-slate-500 pt-1">Nothing on this day.</div>}
      </div>
    </div>
  );
}

function Upcoming({ hidden }: { hidden: Set<Kind> }) {
  const from = todayLocal();
  const to = addDays(from, 59);
  const { items, error } = useItems(from, to);
  if (error) return <div className="text-sm text-red-700">{error}</div>;
  if (!items) return <div className="text-sm text-slate-500">Loading…</div>;
  const shown = items.filter((i) => !hidden.has(i.kind));
  const byDay = new Map<string, Item[]>();
  for (const i of shown) { const d = i.start < from ? from : i.start; byDay.set(d, [...(byDay.get(d) ?? []), i]); }
  if (!byDay.size) return <div className="glass-card rounded-2xl p-6 text-sm text-slate-500">Nothing in the next 60 days.</div>;
  return (
    <div className="space-y-3">
      {[...byDay].map(([d, list]) => (
        <div key={d} className="glass-card rounded-2xl p-4">
          <div className="font-semibold">{d === from ? "Today" : fmtDay(d)}</div>
          {list.map((i) => <ItemLine key={i.id} i={i} />)}
        </div>
      ))}
    </div>
  );
}

type EventRow = { id: string; kind: "holiday" | "event"; title: string; starts_on: string; ends_on: string; start_time: string | null; end_time: string | null;
  location: string | null; description: string | null; office_closed: boolean };
const blank = (): Omit<EventRow, "id"> & { id?: string } => ({ kind: "event", title: "", starts_on: todayLocal(), ends_on: todayLocal(), start_time: null, end_time: null, location: null, description: null, office_closed: false });

function EventForm({ initial, onDone }: { initial: Omit<EventRow, "id"> & { id?: string }; onDone: () => void }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const save = async () => {
    setBusy(true); setMsg("");
    const body = { kind: f.kind, title: f.title, startsOn: f.starts_on, endsOn: f.ends_on || f.starts_on, startTime: f.start_time || null, endTime: f.end_time || null,
      location: f.location, description: f.description, officeClosed: f.office_closed };
    try { if (f.id) await hubPut(`/api/calendar/events/${f.id}`, body); else await hubPost("/api/calendar/events", body); onDone(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const input = "mt-1 w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2";
  return (
    <div className="glass-card rounded-2xl p-5 space-y-3">
      <div className="font-semibold">{f.id ? "Edit" : "Add"} {f.kind === "holiday" ? "holiday" : "event"}</div>
      <div className="flex gap-2">
        {(["event", "holiday"] as const).map((k) => (
          <button key={k} type="button" onClick={() => set({ kind: k })} className={`rounded-xl border px-4 py-2 text-sm font-semibold ${f.kind === k ? "btn-brand" : "border-slate-700 bg-slate-900/70"}`}>{k === "event" ? "Event" : "Holiday"}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <label className="block md:col-span-2">Title<input className={input} value={f.title} onChange={(e) => set({ title: e.target.value })} /></label>
        <label className="block">Starts<input type="date" className={input} value={f.starts_on} onChange={(e) => set({ starts_on: e.target.value, ends_on: f.ends_on < e.target.value ? e.target.value : f.ends_on })} /></label>
        <label className="block">Ends<input type="date" className={input} value={f.ends_on} min={f.starts_on} onChange={(e) => set({ ends_on: e.target.value })} /></label>
        <label className="block">Start time (blank = all day)<input type="time" className={input} value={f.start_time ?? ""} onChange={(e) => set({ start_time: e.target.value || null })} /></label>
        <label className="block">End time<input type="time" className={input} value={f.end_time ?? ""} disabled={!f.start_time} onChange={(e) => set({ end_time: e.target.value || null })} /></label>
        <label className="block md:col-span-2">Location<input className={input} value={f.location ?? ""} onChange={(e) => set({ location: e.target.value })} /></label>
        <label className="block md:col-span-2">Details<textarea rows={3} className={input} value={f.description ?? ""} onChange={(e) => set({ description: e.target.value })} /></label>
        {f.kind === "holiday" && <label className="flex items-center gap-2"><input type="checkbox" checked={f.office_closed} onChange={(e) => set({ office_closed: e.target.checked })} />Office closed</label>}
      </div>
      <div className="flex gap-2 items-center">
        <button type="button" className="btn-brand" disabled={busy || !f.title.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="rounded-xl border border-slate-600 px-4 py-2 text-sm" onClick={onDone}>Cancel</button>
        {msg && <span className="text-sm text-red-700">{msg}</span>}
      </div>
    </div>
  );
}

function Manage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [editing, setEditing] = useState<(Omit<EventRow, "id"> & { id?: string }) | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => hubGet<{ events: EventRow[] }>(`/api/calendar/events?year=${year}`).then((d) => setEvents(d.events)).catch((e: Error) => setMsg({ ok: false, text: e.message }));
  useEffect(() => { void load(); }, [year]);
  const addHolidays = async () => {
    setMsg(null);
    try {
      const r = await hubPost<{ added: number; skipped: number }>("/api/calendar/add-holidays", { year });
      setMsg({ ok: true, text: r.added ? `Added ${r.added} holidays for ${year}${r.skipped ? ` (${r.skipped} were already there)` : ""}. Check them against this year's policy.` : `All the standard holidays for ${year} are already there.` });
      void load();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const remove = async (e: EventRow) => {
    if (!window.confirm(`Remove "${e.title}" (${fmtShort(e.starts_on)})?`)) return;
    try { await hubDelete(`/api/calendar/events/${e.id}`, {}); void load(); } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[-1, 0, 1, 2].map((n) => new Date().getFullYear() + n).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button type="button" className="btn-brand" onClick={() => setEditing(blank())}>Add an event or holiday</button>
        <button type="button" className="rounded-xl border border-slate-600 px-4 py-2 text-sm" onClick={() => void addHolidays()}>Add the standard holidays for {year}</button>
      </div>
      <p className="text-xs text-slate-500">Standard holidays: New Year's Day, Memorial Day, Independence Day, Labor Day, Thanksgiving and the day after, Christmas Eve and Christmas Day, each on the day the office is closed (Saturday → Friday, Sunday → Monday). Edit or remove any that don't apply.</p>
      {msg && <div className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</div>}
      {editing && <EventForm key={editing.id ?? "new"} initial={editing} onDone={() => { setEditing(null); void load(); }} />}
      <div className="glass-card rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {(events ?? []).map((e) => (
              <tr key={e.id} className="border-t border-slate-800 first:border-t-0">
                <td className="p-3 whitespace-nowrap">{fmtShort(e.starts_on)}{e.ends_on !== e.starts_on ? ` – ${fmtShort(e.ends_on)}` : ""}</td>
                <td className="p-3"><span className={`mr-2 rounded px-1.5 text-xs ${STYLE[e.kind].chip}`}>{e.kind === "holiday" ? "Holiday" : "Event"}</span><span className="font-semibold">{e.title}</span>
                  {e.office_closed && <span className="ml-2 text-xs text-red-700">Office closed</span>}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button type="button" className="btn-text" onClick={() => setEditing(e)}>Edit</button>
                  <button type="button" className="btn-text text-red-700" onClick={() => void remove(e)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {events && !events.length && <div className="p-6 text-sm text-slate-500">No holidays or events for {year} yet.</div>}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const [view, setView] = useState<"month" | "upcoming" | "manage">(() => (typeof window !== "undefined" && window.innerWidth < 768 ? "upcoming" : "month"));
  const { hidden, toggle } = useHidden();
  const [canManage, setCanManage] = useState(false);
  const today = todayLocal();
  useEffect(() => { hubGet<{ canManage: boolean }>(`/api/calendar?from=${today}&to=${today}`).then((d) => setCanManage(d.canManage)).catch(() => undefined); }, [today]);
  const tabs = useMemo(() => [["month", "Month"], ["upcoming", "Upcoming"], ...(canManage ? [["manage", "Manage"]] : [])] as [typeof view, string][], [canManage]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <PageTitle title="Calendar">
          Holidays, events, Wednesday meetings, who's out, birthdays and work anniversaries.
        </PageTitle>
        <div className="flex gap-2" role="tablist">
          {tabs.map(([k, n]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold ${view === k ? "btn-brand" : "border-slate-700 bg-slate-900/70"}`}>{n}</button>
          ))}
        </div>
      </div>
      {view !== "manage" && (
        <div className="flex gap-2 flex-wrap">
          {KINDS.map((k) => (
            <button key={k.kind} type="button" aria-pressed={!hidden.has(k.kind)} onClick={() => toggle(k.kind)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${hidden.has(k.kind) ? "border-slate-700 text-slate-600 line-through" : "border-slate-600 bg-slate-900/70"}`}>
              <span className={`h-2 w-2 rounded-full ${k.dot}`} />{k.label}</button>
          ))}
        </div>
      )}
      {view === "month" ? <MonthView hidden={hidden} /> : view === "upcoming" ? <Upcoming hidden={hidden} /> : <Manage />}
    </div>
  );
}
