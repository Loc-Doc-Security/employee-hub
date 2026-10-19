// Weekly Report: a direct line from every employee to ownership.
//   This week          fill it in, or see what you submitted (no edits after submitting)
//   History & trends   your own past reports + stress / morale / workload over time
//   Team status        managers: who has / hasn't submitted, never the answers
//   All reports        C-Suite only: everyone's answers
// What each tab shows is decided by the server; the tabs only appear when the API would allow them.
import { Fragment, useEffect, useMemo, useState } from "react";
import { hubGet, hubPost, useMe } from "../lib/hubApi";
import TrendChart from "../components/TrendChart";

type Report = {
  id: string; week_start: string; stress_level: number; morale: number; workload: number;
  week_high: string; week_low: string; additional_notes: string; submitted_at: string;
};
type Mine = { weekStart: string; current: Report | null; history: Report[] };
type TeamRow = { id: string; name: string; departments: string; submitted: boolean; on_pto: boolean };
type AllRow = Report & { name: string; is_former: boolean };

const SCALES = {
  stress_level: { title: "Stress", hint: "1 = very low · 5 = very high", labels: ["Very low", "Low", "Moderate", "High", "Very high"] },
  morale: { title: "Morale", hint: "1 = very low · 5 = great", labels: ["Very low", "Low", "Moderate", "Good", "Great"] },
  workload: { title: "Workload", hint: "1 = very light · 5 = very heavy", labels: ["Very light", "Light", "Moderate", "Heavy", "Very heavy"] },
} as const;
type ScaleKey = keyof typeof SCALES;
const label = (k: ScaleKey, v: number) => `${v} — ${SCALES[k].labels[v - 1]}`;

const fmtWeek = (w: string) =>
  new Date(`${w}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const shiftWeek = (w: string, weeks: number) => {
  const d = new Date(`${w}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
};

const field = "w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm";

function ReportView({ r }: { r: Report }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(Object.keys(SCALES) as ScaleKey[]).map((k) => (
          <div key={k} className="rounded-xl border border-slate-700 p-3">
            <div className="text-xs text-slate-500">{SCALES[k].title}</div>
            <div className="font-semibold">{label(k, r[k])}</div>
          </div>
        ))}
      </div>
      <div><div className="text-xs text-slate-500">High</div><div className="whitespace-pre-wrap">{r.week_high}</div></div>
      <div><div className="text-xs text-slate-500">Low</div><div className="whitespace-pre-wrap">{r.week_low}</div></div>
      {r.additional_notes && <div><div className="text-xs text-slate-500">Notes</div><div className="whitespace-pre-wrap">{r.additional_notes}</div></div>}
    </div>
  );
}

function ThisWeek({ mine, onSubmitted }: { mine: Mine; onSubmitted: (r: Report) => void }) {
  const [scores, setScores] = useState<Record<ScaleKey, number>>({ stress_level: 3, morale: 3, workload: 3 });
  const [high, setHigh] = useState("");
  const [low, setLow] = useState("");
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (mine.current) {
    return (
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Week of {fmtWeek(mine.weekStart)}: submitted ✓</h2>
          <p className="text-sm text-slate-500">This went straight to ownership. Reports can't be changed after submitting.</p>
        </div>
        <ReportView r={mine.current} />
      </div>
    );
  }

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const saved = await hubPost<Report>("/api/weekly-reports", {
        stressLevel: scores.stress_level, morale: scores.morale, workload: scores.workload,
        weekHigh: high, weekLow: low, additionalNotes: notes,
      });
      onSubmitted(saved);
    } catch (e) {
      setError((e as Error).message);
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  };

  const ready = high.trim() && low.trim();
  return (
    <div className="glass-card rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Week of {fmtWeek(mine.weekStart)}</h2>
        <p className="text-sm text-slate-500">Goes directly to ownership: managers only see whether you submitted, never your answers.</p>
      </div>
      {(Object.keys(SCALES) as ScaleKey[]).map((k) => (
        <div key={k}>
          <div className="flex justify-between text-sm">
            <span className="font-semibold">{SCALES[k].title}</span>
            <span className="text-slate-500">{label(k, scores[k])}</span>
          </div>
          <div className="text-xs text-slate-500 mb-2">{SCALES[k].hint}</div>
          <div className="grid grid-cols-5 gap-2" role="group" aria-label={SCALES[k].title}>
            {[1, 2, 3, 4, 5].map((v) => (
              <button key={v} type="button" aria-pressed={scores[k] === v}
                className={`rounded-xl border py-2 text-sm font-semibold ${scores[k] === v ? "btn-brand" : "border-slate-700 bg-slate-900/70"}`}
                onClick={() => setScores((s) => ({ ...s, [k]: v }))}>{v}</button>
            ))}
          </div>
        </div>
      ))}
      <label className="block text-sm"><span className="font-semibold">What was your high this week?</span>
        <textarea className={`${field} mt-1`} rows={3} value={high} onChange={(e) => setHigh(e.target.value)} /></label>
      <label className="block text-sm"><span className="font-semibold">What was your low this week?</span>
        <textarea className={`${field} mt-1`} rows={3} value={low} onChange={(e) => setLow(e.target.value)} /></label>
      <label className="block text-sm"><span className="font-semibold">Anything else?</span> <span className="text-slate-500">(optional)</span>
        <textarea className={`${field} mt-1`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      {error && <div className="text-sm text-red-700">{error}</div>}
      {!confirming ? (
        <button type="button" className="btn-brand" disabled={!ready} onClick={() => setConfirming(true)}>
          {ready ? "Submit report" : "Fill in your high and low to submit"}
        </button>
      ) : (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3 text-sm text-slate-200">
          <div>Once submitted, this week's report can't be changed. Submit now?</div>
          <div className="flex gap-2">
            <button type="button" className="btn-brand" disabled={saving} onClick={submit}>{saving ? "Submitting…" : "Yes, submit"}</button>
            <button type="button" className="rounded-xl border border-slate-600 px-4 py-2" onClick={() => setConfirming(false)}>Keep editing</button>
          </div>
        </div>
      )}
    </div>
  );
}

const RANGES = [
  { key: "12", label: "12 weeks", weeks: 12 },
  { key: "26", label: "6 months", weeks: 26 },
  { key: "52", label: "1 year", weeks: 52 },
  { key: "all", label: "All", weeks: Infinity },
];

function History({ mine }: { mine: Mine }) {
  const [range, setRange] = useState("26");
  const [open, setOpen] = useState<string | null>(null);
  const inRange = useMemo(() => {
    const weeks = RANGES.find((r) => r.key === range)!.weeks;
    if (!Number.isFinite(weeks)) return mine.history;
    const cutoff = shiftWeek(mine.weekStart, -weeks);
    return mine.history.filter((r) => r.week_start > cutoff);
  }, [mine, range]);

  if (!mine.history.length) return <div className="glass-card rounded-2xl p-6 text-sm text-slate-500">No past reports yet.</div>;
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap" role="group" aria-label="Time range">
        {RANGES.map((r) => (
          <button key={r.key} type="button" aria-pressed={range === r.key}
            className={`rounded-xl border px-3 py-1 text-sm ${range === r.key ? "btn-brand" : "border-slate-700 bg-slate-900/70"}`}
            onClick={() => setRange(r.key)}>{r.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {(Object.keys(SCALES) as ScaleKey[]).map((k) => (
          <TrendChart key={k} title={SCALES[k].title} hint={SCALES[k].hint}
            points={inRange.map((r) => ({ week: r.week_start, value: r[k] }))} />
        ))}
      </div>
      <div className="glass-card rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr><th className="p-3">Week of</th><th className="p-3">Stress</th><th className="p-3">Morale</th><th className="p-3">Workload</th><th className="p-3"></th></tr>
          </thead>
          <tbody>
            {inRange.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-t border-slate-800">
                  <td className="p-3">{fmtWeek(r.week_start)}</td>
                  <td className="p-3">{r.stress_level}</td><td className="p-3">{r.morale}</td><td className="p-3">{r.workload}</td>
                  <td className="p-3 text-right">
                    <button type="button" className="btn-text" onClick={() => setOpen(open === r.id ? null : r.id)}>
                      {open === r.id ? "Hide" : "View"}
                    </button>
                  </td>
                </tr>
                {open === r.id && (
                  <tr className="border-t border-slate-800"><td colSpan={5} className="p-4"><ReportView r={r} /></td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WeekPicker({ week, setWeek }: { week: string; setWeek: (w: string) => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <button type="button" className="rounded-xl border border-slate-700 px-3 py-1" onClick={() => setWeek(shiftWeek(week, -1))}>← Prev</button>
      <span className="font-semibold">Week of {fmtWeek(week)}</span>
      <button type="button" className="rounded-xl border border-slate-700 px-3 py-1" onClick={() => setWeek(shiftWeek(week, 1))}>Next →</button>
    </div>
  );
}

function TeamStatus({ initialWeek }: { initialWeek: string }) {
  const [week, setWeek] = useState(initialWeek);
  const [rows, setRows] = useState<TeamRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setRows(null);
    hubGet<{ people: TeamRow[] }>(`/api/weekly-reports/team?week=${week}`).then((d) => setRows(d.people)).catch((e: Error) => setError(e.message));
  }, [week]);
  const done = rows?.filter((r) => r.submitted).length ?? 0;
  return (
    <div className="space-y-3">
      <WeekPicker week={week} setWeek={setWeek} />
      <p className="text-sm text-slate-500">Who has submitted. Answers go only to ownership and aren't shown here.</p>
      {error && <div className="text-sm text-red-700">{error}</div>}
      {rows && (
        <div className="glass-card rounded-2xl overflow-x-auto">
          <div className="p-3 text-sm font-semibold">{done} of {rows.length - rows.filter((r) => r.on_pto && !r.submitted).length} submitted{rows.some((r) => r.on_pto && !r.submitted) ? ` · ${rows.filter((r) => r.on_pto && !r.submitted).length} on PTO` : ""}</div>
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-800">
                  <td className="p-3">{r.name}</td>
                  <td className="p-3 text-slate-500">{r.departments || "—"}</td>
                  <td className="p-3">{r.submitted ? "✓ Submitted" : r.on_pto ? "On PTO" : "— Not yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AllReports({ initialWeek }: { initialWeek: string }) {
  const [week, setWeek] = useState(initialWeek);
  const [rows, setRows] = useState<AllRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setRows(null);
    hubGet<{ reports: AllRow[] }>(`/api/weekly-reports/all?week=${week}`).then((d) => setRows(d.reports)).catch((e: Error) => setError(e.message));
  }, [week]);
  return (
    <div className="space-y-3">
      <WeekPicker week={week} setWeek={setWeek} />
      <p className="text-sm text-slate-500">Visible to C-Suite only.</p>
      {error && <div className="text-sm text-red-700">{error}</div>}
      {rows && rows.length === 0 && <div className="glass-card rounded-2xl p-6 text-sm text-slate-500">No reports for this week.</div>}
      {rows?.map((r) => (
        <div key={r.id} className="glass-card rounded-2xl p-5 space-y-3">
          <div className="font-semibold">{r.name}{r.is_former && <span className="ml-2 text-xs text-slate-600">former employee</span>}</div>
          <ReportView r={r} />
        </div>
      ))}
    </div>
  );
}

export default function WeeklyReportPage() {
  const { me } = useMe();
  const [mine, setMine] = useState<Mine | null>(null);
  const [tab, setTab] = useState("week");
  const [error, setError] = useState("");
  useEffect(() => {
    hubGet<Mine>("/api/weekly-reports/mine").then(setMine).catch((e: Error) => setError(e.message));
  }, []);

  const canTeam = !!me?.permissions["reports.view_team"];
  const canAll = !!me?.permissions["weekly_reports.read_all"];
  const tabs = [
    ["week", "This week"],
    ["history", "History & trends"],
    ...(canTeam ? [["team", "Team status"]] : []),
    ...(canAll ? [["all", "All reports"]] : []),
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Weekly Report</h1>
      <div className="flex gap-2 flex-wrap" role="tablist">
        {tabs.map(([key, name]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${tab === key ? "btn-brand" : "border-slate-700 bg-slate-900/70"}`}
            onClick={() => setTab(key)}>{name}</button>
        ))}
      </div>
      {error && <div className="glass-card rounded-2xl p-4 text-sm text-red-700">{error}</div>}
      {!mine && !error && <div className="text-sm text-slate-500">Loading…</div>}
      {mine && tab === "week" && (
        <ThisWeek mine={mine} onSubmitted={(r) => setMine({ ...mine, current: r, history: [r, ...mine.history] })} />
      )}
      {mine && tab === "history" && <History mine={mine} />}
      {mine && tab === "team" && canTeam && <TeamStatus initialWeek={mine.weekStart} />}
      {mine && tab === "all" && canAll && <AllReports initialWeek={mine.weekStart} />}
    </div>
  );
}
