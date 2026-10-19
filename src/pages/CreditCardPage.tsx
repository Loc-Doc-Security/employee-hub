// Credit Card receipts (28-day rolling, synced weekly from accounting's sheet).
// Everyone: company and team totals. You: your own numbers and your team's total. Managers: the
// people on their teams, lowest first. Team totals are weighted (receipts ÷ purchases).
// Accounting (expenses.sync) also gets a bar to connect their Sheet and "Sync now" after a
// last-minute change; it syncs by itself Tuesdays 9am Eastern.
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { hubGet, hubPost, hubPut, useMe } from "../lib/hubApi";
import TrendChart from "../components/TrendChart";
import PageTitle from "../components/PageTitle";

type Dept = { department: string; purchases: number; receipts: number; people: number; percent: number | null };
type Report = {
  week: string; weeks: string[];
  company: { purchases: number; receipts: number; percent: number | null };
  departments: Dept[];
  mine: { purchases: number; receipts: number; percent: number | null; department: string; departmentPercent: number | null } | null;
  team: { name: string; department: string; purchases: number; receipts: number; percent: number | null }[] | null;
  trend: { week: string; percent: number | null }[];
};

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const show = (p: number | null) => (p == null ? "—" : `${p}%`);

export function DepartmentBars({ departments }: { departments: Dept[] }) {
  return (
    <div className="space-y-2">
      {departments.map((d) => (
        <div key={d.department} className="grid grid-cols-[10rem_1fr_4rem] items-center gap-3 text-sm">
          <span className="truncate">{d.department}</span>
          <div className="h-2 rounded-full bg-slate-700/70 overflow-hidden">
            {d.percent != null && <div className="h-full rounded-full" style={{ width: `${d.percent}%`, background: "var(--theme-accent-600, #2563eb)" }} />}
          </div>
          <span className="text-right font-semibold">{show(d.percent)}</span>
        </div>
      ))}
    </div>
  );
}

type SyncStatus = {
  googleConnected: boolean; serviceAccountEmail: string | null;
  source: null | {
    sheetUrl: string; lastSyncedAt: string | null; lastSyncedBy: string | null;
    lastResult: null | { error?: string; tab?: string; saved?: number; unmatched?: { name: string; reason: string }[] };
  };
};

function SyncBar({ onSynced }: { onSynced: () => void }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [sheet, setSheet] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const load = () => hubGet<SyncStatus>("/api/credit-card/sync").then(setStatus).catch((e: Error) => setMsg(e.message));
  useEffect(() => { void load(); }, []);
  const act = async (what: "sync" | "save") => {
    setBusy(what); setMsg("");
    try {
      if (what === "save") { await hubPut("/api/credit-card/sync/source", { sheet }); setSheet(""); setEditing(false); }
      else { await hubPost("/api/credit-card/sync", {}); onSynced(); }
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(""); void load(); }
  };
  if (!status) return msg ? <div className="text-sm text-red-700">{msg}</div> : null;
  const r = status.source?.lastResult;
  return (
    <div className="glass-card rounded-2xl p-4 space-y-2 text-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <span className="font-semibold">Accounting sync</span>
          {status.source?.lastSyncedAt
            ? <span className="text-slate-500"> · last synced {new Date(status.source.lastSyncedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{status.source.lastSyncedBy ? ` by ${status.source.lastSyncedBy}` : " (automatic)"}</span>
            : <span className="text-slate-500"> · syncs by itself Tuesdays at 9am</span>}
        </div>
        <div className="flex gap-2">
          {status.source && <a className="btn-text" href={status.source.sheetUrl} target="_blank" rel="noreferrer">Open Sheet</a>}
          <button type="button" className="btn-text" onClick={() => setEditing(!editing)}>{status.source ? "Change Sheet" : "Connect Sheet"}</button>
          {status.source && status.googleConnected && (
            <button type="button" className="btn-brand inline-flex items-center gap-2" disabled={!!busy} onClick={() => void act("sync")}>
              <RefreshCw className={`w-4 h-4 ${busy === "sync" ? "animate-spin" : ""}`} /> {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
          )}
        </div>
      </div>
      {!status.googleConnected && <div className="text-amber-800">Google isn't connected on this server yet, so the Sheet can't be read.</div>}
      {r?.error && <div className="text-red-700">Last sync failed: {r.error}</div>}
      {r && !r.error && <div className="text-slate-400">{r.saved} people synced from "{r.tab}". Replaces this week's numbers; earlier weeks are kept.</div>}
      {!!r?.unmatched?.length && (
        <details><summary className="cursor-pointer text-amber-800">{r.unmatched.length} row(s) on the Sheet didn't match anyone</summary>
          <ul className="mt-1 list-disc pl-5 text-slate-400">{r.unmatched.map((u) => <li key={u.name + u.reason}><b>{u.name}</b>: {u.reason}</li>)}</ul>
        </details>
      )}
      {editing && (
        <div className="space-y-1">
          {status.serviceAccountEmail && <div className="text-slate-400">Share the Sheet with <code className="font-mono">{status.serviceAccountEmail}</code> as Viewer.</div>}
          <div className="flex gap-2 flex-wrap">
            <input value={sheet} onChange={(e) => setSheet(e.target.value)} placeholder="Paste the Sheet's link (open the right tab first)"
              className="flex-1 min-w-[16rem] rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2" />
            <button type="button" className="rounded-xl border border-slate-600 px-4 py-2" disabled={!sheet.trim() || !!busy} onClick={() => void act("save")}>Save</button>
          </div>
        </div>
      )}
      {msg && <div className="text-red-700">{msg}</div>}
    </div>
  );
}

export default function CreditCardPage() {
  const { me } = useMe();
  const [version, setVersion] = useState(0);
  return (
    <div className="space-y-4">
      {me?.permissions["expenses.sync"] && <SyncBar onSynced={() => setVersion((v) => v + 1)} />}
      <Report key={version} />
    </div>
  );
}

function Report() {
  const [week, setWeek] = useState("");
  const [data, setData] = useState<Report | null | undefined>(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    hubGet<Report | null>(`/api/credit-card/report${week ? `?week=${week}` : ""}`).then(setData).catch((e: Error) => setError(e.message));
  }, [week]);

  if (error) return <div className="glass-card rounded-2xl p-6 text-sm text-red-700">{error}</div>;
  if (data === undefined) return <div className="text-sm text-slate-500">Loading…</div>;
  if (data === null) return <div className="glass-card rounded-2xl p-6 text-sm">No receipt data has been synced yet.</div>;
  const trend = data.trend.filter((t) => t.percent != null).map((t) => ({ week: t.week, value: t.percent as number }));

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <PageTitle title="Credit Card Receipts">
          Receipts uploaded vs. card purchases over the last 28 days, as of the week of {fmt(data.week)}.
        </PageTitle>
        {data.weeks.length > 1 && (
          <select className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm" value={data.week} onChange={(e) => setWeek(e.target.value)}>
            {data.weeks.map((w) => <option key={w} value={w}>Week of {fmt(w)}</option>)}
          </select>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card rounded-2xl p-6">
          <div className="text-xs text-slate-500">Company</div>
          <div className="text-4xl font-black">{show(data.company.percent)}</div>
          <div className="text-sm text-slate-500">{data.company.receipts} of {data.company.purchases} receipts uploaded</div>
        </div>
        {data.mine && (
          <div className="glass-card rounded-2xl p-6">
            <div className="text-xs text-slate-500">You</div>
            <div className="text-4xl font-black">{show(data.mine.percent)}</div>
            <div className="text-sm text-slate-500">
              {data.mine.receipts} of {data.mine.purchases} receipts uploaded · {data.mine.department}: {show(data.mine.departmentPercent)}
            </div>
          </div>
        )}
      </div>

      <div className="glass-card rounded-2xl p-6 space-y-3">
        <div className="font-semibold">By team</div>
        <DepartmentBars departments={data.departments} />
      </div>

      {trend.length > 1 && <TrendChart title="Company receipt rate" hint="Weekly, 0–100%" points={trend} min={0} max={100} ticks={[0, 25, 50, 75, 100]} />}

      {data.team && data.team.length > 0 && (
        <div className="glass-card rounded-2xl overflow-x-auto">
          <div className="p-3 text-xs text-slate-500">Your team · lowest first</div>
          <table className="w-full text-sm">
            <tbody>
              {data.team.map((t) => (
                <tr key={t.name} className="border-t border-slate-800">
                  <td className="p-3"><div className="font-semibold">{t.name}</div><div className="text-xs text-slate-500">{t.department}</div></td>
                  <td className="p-3">{t.receipts} of {t.purchases}</td>
                  <td className="p-3 font-semibold">{show(t.percent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
