// Team Report: the monthly manager meeting view.
//   My team    one row per person: overall, weekly reports, peer assessment given, cleanliness, 1:1.
//              PTO weeks are noted and never count against anyone. Click a name for the full card.
//   Managers   Operations / C-Suite only: team size, team average, 1:1 completion per manager.
//              Company-wide managers are listed separately (their "team" is everyone).
import { useEffect, useState } from "react";
import { hubGet, useMe } from "../lib/hubApi";
import { ScoreCard } from "./MyScorePage";
import PageTitle from "../components/PageTitle";

type Row = {
  id: string; name: string; departments: string; oneOnOne: boolean; overall: number; participation: number; level: string;
  weekly: { done: boolean; count: number; owed: number }; peerGiven: number;
  cleanliness: { done: boolean; count: number; owed: number }; cleanlinessAvg: number | null; ptoWeeks: string[];
};
type ManagerRow = { id: string; name: string; companyWide: boolean; teamSize: number; teamAverage: number | null; oneOnOnesDone: number };

const fmtMonth = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const shiftMonth = (m: string, n: number) => {
  const d = new Date(`${m}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};
const thisMonth = () => new Date().toISOString().slice(0, 7);
const mark = (ok: boolean, text: string) => <span className={ok ? "font-semibold" : "text-slate-500"}>{ok ? "✓" : "–"} {text}</span>;

function MyTeam({ month }: { month: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<Row | null>(null);
  const [card, setCard] = useState<Parameters<typeof ScoreCard>[0]["card"] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setRows(null);
    hubGet<{ people: Row[] }>(`/api/team-report?month=${month}`).then((d) => setRows(d.people)).catch((e: Error) => setError(e.message));
  }, [month]);
  useEffect(() => {
    setCard(null);
    if (open) hubGet<{ card: Parameters<typeof ScoreCard>[0]["card"] }>(`/api/scorecard/employee/${open.id}?month=${month}`).then((d) => setCard(d.card)).catch((e: Error) => setError(e.message));
  }, [open, month]);

  if (error) return <div className="text-sm text-red-700">{error}</div>;
  if (!rows) return <div className="text-sm text-slate-500">Loading…</div>;
  if (open) {
    return (
      <div className="space-y-3">
        <button type="button" className="btn-text" onClick={() => setOpen(null)}>← Back to team</button>
        <h2 className="text-xl font-semibold">{open.name}</h2>
        {card ? <ScoreCard card={card} /> : <div className="text-sm text-slate-500">Loading…</div>}
      </div>
    );
  }
  if (!rows.length) return <div className="glass-card rounded-2xl p-6 text-sm text-slate-500">No one in your departments yet.</div>;
  const avg = Math.round(rows.reduce((s, r) => s + r.overall, 0) / rows.length);
  const oneOnOnes = rows.filter((r) => r.oneOnOne).length;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[["People", rows.length], ["Team average", `${avg}%`], ["1:1s this month", `${oneOnOnes} of ${rows.length}`]].map(([l, v]) => (
          <div key={l} className="glass-card rounded-2xl p-4"><div className="text-xs text-slate-500">{l}</div><div className="text-2xl font-bold">{v}</div></div>
        ))}
      </div>
      <div className="glass-card rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr><th className="p-3">Name</th><th className="p-3">Overall</th><th className="p-3">Weekly reports</th><th className="p-3">Peer assessment</th><th className="p-3">Cleanliness</th><th className="p-3">1:1</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-800">
                <td className="p-3">
                  <button type="button" className="font-semibold hover:underline text-left" onClick={() => setOpen(r)}>{r.name}</button>
                  <div className="text-xs text-slate-500">{r.departments || "—"}{r.ptoWeeks.length ? ` · PTO ${r.ptoWeeks.length} wk` : ""}</div>
                </td>
                <td className="p-3 font-semibold">{r.overall}%<div className="text-xs font-normal text-slate-500">{r.level}</div></td>
                <td className="p-3">{mark(r.weekly.done, `${r.weekly.count} of ${r.weekly.owed}`)}</td>
                <td className="p-3">{mark(r.peerGiven > 0, `${r.peerGiven} given`)}</td>
                <td className="p-3">{mark(r.cleanliness.done, r.cleanlinessAvg === null ? "—" : `${r.cleanlinessAvg}%`)}</td>
                <td className="p-3">{mark(r.oneOnOne, r.oneOnOne ? "Done" : "Not yet")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Managers({ month }: { month: string }) {
  const [rows, setRows] = useState<ManagerRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setRows(null);
    hubGet<{ managers: ManagerRow[] }>(`/api/team-report/managers?month=${month}`).then((d) => setRows(d.managers)).catch((e: Error) => setError(e.message));
  }, [month]);
  if (error) return <div className="text-sm text-red-700">{error}</div>;
  if (!rows) return <div className="text-sm text-slate-500">Loading…</div>;
  // Company-wide managers' "team" is everyone, so they're listed apart from department managers.
  const wide = rows.filter((m) => m.companyWide);
  const dept = rows.filter((m) => !m.companyWide);
  const table = (list: ManagerRow[]) => (
    <table className="w-full text-sm">
      <thead className="text-left text-slate-500"><tr><th className="p-3">Manager</th><th className="p-3">Team</th><th className="p-3">Team average</th><th className="p-3">1:1s this month</th></tr></thead>
      <tbody>
        {list.map((m) => (
          <tr key={m.id} className="border-t border-slate-800">
            <td className="p-3 font-semibold">{m.name}</td>
            <td className="p-3">{m.teamSize}</td>
            <td className="p-3">{m.teamAverage === null ? "—" : `${m.teamAverage}%`}</td>
            <td className="p-3">{m.oneOnOnesDone} of {m.teamSize}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl overflow-x-auto">{table(dept)}</div>
      {wide.length > 0 && (
        <div className="glass-card rounded-2xl overflow-x-auto">
          <div className="px-3 pt-3 text-xs text-slate-500">Company-wide managers (everyone counts as their team)</div>
          {table(wide)}
        </div>
      )}
    </div>
  );
}

export default function TeamReportPage() {
  const { me } = useMe();
  const [month, setMonth] = useState(thisMonth());
  const [tab, setTab] = useState<"team" | "managers">("team");
  const r = me?.permissions["reports.view_team"];
  const companyWide = !!r && (r.all || r.companyIds.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <PageTitle title="Team Report">
          <div className="flex items-center gap-2 text-sm mt-1">
            <button type="button" className="rounded-xl border border-slate-700 px-3 py-1" onClick={() => setMonth(shiftMonth(month, -1))}>← Prev</button>
            <span className="font-semibold">{fmtMonth(month)}</span>
            <button type="button" className="rounded-xl border border-slate-700 px-3 py-1" disabled={month >= thisMonth()} onClick={() => setMonth(shiftMonth(month, 1))}>Next →</button>
          </div>
        </PageTitle>
        {companyWide && (
          <div className="flex gap-2" role="tablist">
            {([["team", "My team"], ["managers", "Managers"]] as const).map(([k, n]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold ${tab === k ? "btn-brand" : "border-slate-700 bg-slate-900/70"}`}>{n}</button>
            ))}
          </div>
        )}
      </div>
      {tab === "managers" && companyWide ? <Managers month={month} /> : <MyTeam month={month} />}
    </div>
  );
}
