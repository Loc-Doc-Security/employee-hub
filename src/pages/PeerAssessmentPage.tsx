// Peer Assessments: teammates score each other monthly on the six core values (1–4).
//   Assess teammates   this month's list (department + random picks), fixed for the month
//   My results         my averages + feedback, never who wrote it; trend over months
//   Team results       managers: averages for their people, no feedback, no names
//   All assessments    C-Suite only: who assessed whom
// The server enforces all of this; tabs only appear where the API would allow them.
import { useEffect, useState } from "react";
import { hubGet, hubPost, useMe } from "../lib/hubApi";
import TrendChart from "../components/TrendChart";

const CRITERIA = [
  { key: "humble", label: "Humble", desc: "Acknowledges mistakes, accepts feedback, doesn't seek undue credit" },
  { key: "hungry", label: "Hungry", desc: "Self-motivated, goes above and beyond, proactively takes on challenges" },
  { key: "smart", label: "Smart", desc: "People-smart: reads the room, communicates effectively, builds rapport" },
  { key: "helpful_kind", label: "Helpful & Kind", desc: "Consistently helpful and kind to teammates and customers" },
  { key: "fast_response", label: "Fast Response", desc: "Promptly responds to requests, tickets, and communications" },
  { key: "solves_problems", label: "Solves Problems", desc: "Identifies root causes and finds effective, lasting solutions" },
] as const;
type CKey = (typeof CRITERIA)[number]["key"];
const SCORE_LABELS = ["Needs Improvement", "Meets Expectations", "Exceeds Expectations", "Outstanding"];

type Assignment = { id: string; name: string; departments: string; reason: "department" | "random"; done: boolean };
type Averages = { count: number } & Record<CKey, number | null>;
type Received = { month: string; averages: Averages; feedback: string[]; history: (Averages & { month: string })[] };
type TeamRow = Averages & { id: string; name: string };
type FullRow = Record<CKey, number> & {
  id: string; assessed_on: string; subject: string; submitted_by: string;
  criterion_feedback: Record<string, string>; general_feedback: string;
};

const field = "w-full rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm";
const fmtMonth = (m: string) =>
  new Date(`${m.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const fmtMonthShort = (m: string) =>
  new Date(`${m.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const shiftMonth = (m: string, n: number) => {
  const d = new Date(`${m.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};
const thisMonth = () => new Date().toISOString().slice(0, 7);
const overall = (a: Partial<Record<CKey, number | null>>) => {
  const v = CRITERIA.map((c) => a[c.key]).filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

function MonthPicker({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <button type="button" className="rounded-xl border border-slate-200 px-3 py-1" onClick={() => setMonth(shiftMonth(month, -1))}>← Prev</button>
      <span className="font-semibold">{fmtMonth(month)}</span>
      <button type="button" className="rounded-xl border border-slate-200 px-3 py-1" onClick={() => setMonth(shiftMonth(month, 1))}>Next →</button>
    </div>
  );
}

function ScoreBars({ a }: { a: Partial<Record<CKey, number | null>> }) {
  return (
    <div className="space-y-2">
      {CRITERIA.map((c) => {
        const v = a[c.key];
        return (
          <div key={c.key} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3 text-sm">
            <span>{c.label}</span>
            <div className="h-2 rounded-full bg-slate-200/70 overflow-hidden">
              {typeof v === "number" && <div className="h-full rounded-full" style={{ width: `${(v / 4) * 100}%`, background: "var(--theme-accent-600, #2563eb)" }} />}
            </div>
            <span className="text-right font-semibold">{typeof v === "number" ? v.toFixed(2) : "—"}</span>
          </div>
        );
      })}
    </div>
  );
}

function AssessForm({ person, onDone, onCancel }: { person: Assignment; onDone: () => void; onCancel: () => void }) {
  const [scores, setScores] = useState<Partial<Record<CKey, number>>>({});
  const [notes, setNotes] = useState<Partial<Record<CKey, string>>>({});
  const [general, setGeneral] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const needsNote = (k: CKey) => scores[k] === 1 || scores[k] === 4;
  const missing = CRITERIA.filter((c) => !scores[c.key] || (needsNote(c.key) && !notes[c.key]?.trim()));

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      await hubPost("/api/peer-assessments", {
        subjectId: person.id, scores,
        criterionFeedback: Object.fromEntries(CRITERIA.filter((c) => needsNote(c.key)).map((c) => [c.key, notes[c.key] ?? ""])),
        generalFeedback: general,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Assessing {person.name}</h2>
        <p className="text-sm text-slate-500">{person.name} will see averages and feedback, never your name. A 1 or 4 needs a short note on why.</p>
      </div>
      {CRITERIA.map((c) => (
        <div key={c.key}>
          <div className="text-sm font-semibold">{c.label}</div>
          <div className="text-xs text-slate-500 mb-2">{c.desc}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label={c.label}>
            {[1, 2, 3, 4].map((v) => (
              <button key={v} type="button" aria-pressed={scores[c.key] === v}
                className={`rounded-xl border px-2 py-2 text-xs font-semibold ${scores[c.key] === v ? "btn-brand" : "border-slate-200 bg-white/70"}`}
                onClick={() => setScores((s) => ({ ...s, [c.key]: v }))}>{v} · {SCORE_LABELS[v - 1]}</button>
            ))}
          </div>
          {needsNote(c.key) && (
            <textarea className={`${field} mt-2`} rows={2} placeholder={`Why a ${scores[c.key]}? (required)`}
              value={notes[c.key] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [c.key]: e.target.value }))} />
          )}
        </div>
      ))}
      <label className="block text-sm"><span className="font-semibold">Anything else for {person.name.split(" ")[0]}?</span> <span className="text-slate-500">(optional)</span>
        <textarea className={`${field} mt-1`} rows={3} value={general} onChange={(e) => setGeneral(e.target.value)} /></label>
      {error && <div className="text-sm text-red-700">{error}</div>}
      {!confirming ? (
        <div className="flex gap-2">
          <button type="button" className="btn-brand" disabled={missing.length > 0} onClick={() => setConfirming(true)}>
            {missing.length ? `Finish ${missing.length} more to submit` : "Submit assessment"}
          </button>
          <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm" onClick={onCancel}>Back to list</button>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3 text-sm text-slate-800">
          <div>Assessments can't be changed after submitting. Submit now?</div>
          <div className="flex gap-2">
            <button type="button" className="btn-brand" disabled={saving} onClick={submit}>{saving ? "Submitting…" : "Yes, submit"}</button>
            <button type="button" className="rounded-xl border border-slate-300 px-4 py-2" onClick={() => setConfirming(false)}>Keep editing</button>
          </div>
        </div>
      )}
    </div>
  );
}

type AssignmentData = { month: string; people: Assignment[]; doneIds: string[] };
type DirectoryPerson = { id: string; first_name: string; last_name: string; departments: string[] };

function AssessTab() {
  const { me } = useMe();
  const [data, setData] = useState<AssignmentData | null>(null);
  const [directory, setDirectory] = useState<DirectoryPerson[]>([]);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<Assignment | null>(null);
  const [error, setError] = useState("");
  const load = () => hubGet<AssignmentData>("/api/peer-assessments/assignments").then(setData).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    hubGet<DirectoryPerson[]>("/api/employees").then(setDirectory).catch(() => setDirectory([]));
  }, []);

  if (error) return <div className="text-sm text-red-700">{error}</div>;
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  if (active) return <AssessForm person={active} onCancel={() => setActive(null)} onDone={() => { setActive(null); void load(); }} />;

  const doneIds = new Set(data.doneIds);
  const onList = new Set(data.people.map((p) => p.id));
  const done = data.people.filter((p) => doneIds.has(p.id)).length;
  const row = (p: { id: string; name: string; departments: string }, reason: Assignment["reason"]) => (
    <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 first:border-t-0">
      <div>
        <div className="font-semibold">{p.name}</div>
        <div className="text-xs text-slate-500">{p.departments || "—"}</div>
      </div>
      {doneIds.has(p.id) ? <span className="text-sm text-slate-500">✓ Done</span>
        : <button type="button" className="btn-brand" onClick={() => setActive({ ...p, reason, done: false })}>Assess</button>}
    </div>
  );
  const group = (reason: Assignment["reason"], title: string) => {
    const list = data.people.filter((p) => p.reason === reason);
    if (!list.length) return null;
    return (
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
        {list.map((p) => row(p, reason))}
      </div>
    );
  };

  const q = search.trim().toLowerCase();
  const results = q
    ? directory
        .filter((d) => d.id !== me?.employee?.id && !onList.has(d.id))
        .filter((d) => `${d.first_name} ${d.last_name} ${d.departments.join(" ")}`.toLowerCase().includes(q))
        .slice(0, 20)
    : [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600"><span className="font-semibold">My Team · {fmtMonth(data.month)}:</span> {done} of {data.people.length} done. This list is set for the month.</p>
      {group("department", "Your department")}
      {group("random", "Picked at random this month")}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-4 space-y-2">
          <div className="text-sm font-semibold">Assess someone else</div>
          <div className="text-xs text-slate-500">Anyone in the company, if they deserve an assessment outside your list.</div>
          <input className={field} placeholder="Search by name or department" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {q && results.length === 0 && <div className="px-4 pb-4 text-sm text-slate-500">No one else matches.</div>}
        {results.map((d) => row({ id: d.id, name: `${d.first_name} ${d.last_name}`, departments: d.departments.join(", ") }, "random"))}
      </div>
    </div>
  );
}

function ResultsTab() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Received | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    hubGet<Received>(`/api/peer-assessments/received?month=${month}`).then(setData).catch((e: Error) => setError(e.message));
  }, [month]);
  const trend = (data?.history ?? []).map((h) => ({ week: `${h.month}-01`, value: Number((overall(h) ?? 0).toFixed(2)) }));
  return (
    <div className="space-y-4">
      <MonthPicker month={month} setMonth={setMonth} />
      {error && <div className="text-sm text-red-700">{error}</div>}
      {data && (
        <>
          <div className="glass-card rounded-2xl p-6 space-y-4">
            <div className="text-sm text-slate-600">
              {data.averages.count ? `${data.averages.count} teammate${data.averages.count === 1 ? "" : "s"} assessed you. Names are never shown.` : "No assessments received this month."}
            </div>
            {data.averages.count > 0 && <ScoreBars a={data.averages} />}
            {data.feedback.length > 0 && (
              <div className="space-y-2 pt-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Feedback received</div>
                {data.feedback.map((f, i) => <div key={i} className="rounded-xl bg-slate-100/70 px-3 py-2 text-sm">{f}</div>)}
              </div>
            )}
          </div>
          {trend.length > 1 && (
            <TrendChart title="Overall average" hint="All six criteria, 1–4, by month" points={trend} max={4} formatLabel={fmtMonthShort} />
          )}
        </>
      )}
    </div>
  );
}

function TeamTab() {
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState<TeamRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setRows(null);
    hubGet<{ people: TeamRow[] }>(`/api/peer-assessments/team?month=${month}`).then((d) => setRows(d.people)).catch((e: Error) => setError(e.message));
  }, [month]);
  return (
    <div className="space-y-3">
      <MonthPicker month={month} setMonth={setMonth} />
      <p className="text-sm text-slate-500">Averages only. Feedback goes to the person, and names stay private.</p>
      {error && <div className="text-sm text-red-700">{error}</div>}
      {rows && (
        <div className="glass-card rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr><th className="p-3">Name</th><th className="p-3">Received</th>{CRITERIA.map((c) => <th key={c.key} className="p-3">{c.label}</th>)}<th className="p-3">Overall</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const o = overall(r);
                return (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="p-3">{r.name}</td>
                    <td className="p-3">{r.count}</td>
                    {CRITERIA.map((c) => <td key={c.key} className="p-3">{r[c.key]?.toFixed(2) ?? "—"}</td>)}
                    <td className="p-3 font-semibold">{o === null ? "—" : o.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AllTab() {
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState<FullRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setRows(null);
    hubGet<{ assessments: FullRow[] }>(`/api/peer-assessments/all?month=${month}`).then((d) => setRows(d.assessments)).catch((e: Error) => setError(e.message));
  }, [month]);
  return (
    <div className="space-y-3">
      <MonthPicker month={month} setMonth={setMonth} />
      <p className="text-sm text-slate-500">Visible to C-Suite only.</p>
      {error && <div className="text-sm text-red-700">{error}</div>}
      {rows && rows.length === 0 && <div className="glass-card rounded-2xl p-6 text-sm text-slate-500">No assessments this month.</div>}
      {rows?.map((r) => (
        <div key={r.id} className="glass-card rounded-2xl p-5 space-y-3">
          <div className="text-sm"><span className="font-semibold">{r.submitted_by}</span> → <span className="font-semibold">{r.subject}</span> <span className="text-slate-500">· {r.assessed_on}</span></div>
          <ScoreBars a={r} />
          {Object.entries(r.criterion_feedback).map(([k, t]) => <div key={k} className="text-sm"><span className="text-slate-500">{k.replace(/_/g, " ")}:</span> {t}</div>)}
          {r.general_feedback && <div className="text-sm whitespace-pre-wrap">{r.general_feedback}</div>}
        </div>
      ))}
    </div>
  );
}

export default function PeerAssessmentPage() {
  const { me } = useMe();
  const [tab, setTab] = useState("assess");
  const tabs = [
    ["assess", "Assess teammates"],
    ["results", "My results"],
    ...(me?.permissions["reports.view_team"] ? [["team", "Team results"]] : []),
    ...(me?.permissions["peer_assessments.see_authors"] ? [["all", "All assessments"]] : []),
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Peer Assessments</h1>
      <div className="flex gap-2 flex-wrap" role="tablist">
        {tabs.map(([key, name]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${tab === key ? "btn-brand" : "border-slate-200 bg-white/70"}`}
            onClick={() => setTab(key)}>{name}</button>
        ))}
      </div>
      {tab === "assess" && <AssessTab />}
      {tab === "results" && <ResultsTab />}
      {tab === "team" && me?.permissions["reports.view_team"] && <TeamTab />}
      {tab === "all" && me?.permissions["peer_assessments.see_authors"] && <AllTab />}
    </div>
  );
}
