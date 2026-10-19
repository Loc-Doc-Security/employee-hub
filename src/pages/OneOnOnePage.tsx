// 1:1 meetings.
//   My team   (managers, Operations, C-Suite) roster with ✓ done this month; pick someone to see their
//             history and, for their managers, log a 1:1 with a guided walkthrough:
//             1 Review (this month's numbers + site visits + areas for improvement)
//             2 Conversation   3 Follow-ups
//   My 1:1s   every employee: their own 1:1s, read-only
// No edits after saving. Employees don't reply here; the Weekly Report is their channel.
import { useEffect, useState } from "react";
import { hubGet, hubPost, useMe } from "../lib/hubApi";

type RosterRow = { id: string; name: string; departments: string; done_this_month: boolean; last_met_on: string | null; canWrite: boolean };
type Meeting = {
  id: string; met_on: string; manager: string; areas_of_improvement: string; whats_going_well: string;
  whats_not_going_well: string; needs: string; how_can_i_help: string; site_visits: { label: string; notes: string }[]; follow_ups: string;
};
type Review = {
  month: string;
  weekly: { submitted: number; weeks_so_far: number };
  peer: { received: number; overall: number | null };
  cleanliness: { week: string; score: number }[];
  pto: string[];
  driver: { week_label: string; score: number | null; is_parked: boolean; parked_reason: string | null }[];
};
type Detail = { canWrite: boolean; history: Meeting[]; review: Review };

const CONVERSATION = [
  { key: "whatsGoingWell", label: "What's going well?" },
  { key: "whatsNotGoingWell", label: "What isn't going well?" },
  { key: "needs", label: "What do you need from us? (tools / communication)" },
  { key: "howCanIHelp", label: "What can I do to help?" },
] as const;
const field = "w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm";
const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function MeetingCard({ m }: { m: Meeting }) {
  const rows: [string, string][] = [
    ["Areas for improvement", m.areas_of_improvement], ["What's going well", m.whats_going_well],
    ["What isn't going well", m.whats_not_going_well], ["Needs", m.needs], ["How I can help", m.how_can_i_help],
    ["Follow-ups", m.follow_ups],
  ];
  return (
    <div className="glass-card rounded-2xl p-5 space-y-2">
      <div className="font-semibold">{fmt(m.met_on)} <span className="text-sm font-normal text-slate-500">with {m.manager}</span></div>
      {rows.filter(([, v]) => v).map(([label, v]) => (
        <div key={label} className="text-sm"><div className="text-xs text-slate-500">{label}</div><div className="whitespace-pre-wrap">{v}</div></div>
      ))}
      {m.site_visits.length > 0 && (
        <div className="text-sm">
          <div className="text-xs text-slate-500">Site visits reviewed</div>
          {m.site_visits.map((v, i) => <div key={i}><span className="font-semibold">{v.label}</span>{v.notes ? `: ${v.notes}` : ""}</div>)}
        </div>
      )}
    </div>
  );
}

function ReviewNumbers({ r }: { r: Review }) {
  const tiles: [string, string][] = [
    ["Weekly reports", `${r.weekly.submitted} of ${r.weekly.weeks_so_far} weeks`],
    ["Peer assessments", r.peer.received ? `${r.peer.received} received · avg ${r.peer.overall?.toFixed(2)}` : "None yet"],
    ["Cleanliness", r.cleanliness.length ? r.cleanliness.map((c) => `${c.score}%`).join(" · ") : "No audits yet"],
    ["PTO weeks", r.pto.length ? r.pto.map(fmt).join(", ") : "None"],
    ...(r.driver.length ? [["Driver score", r.driver.map((d) => (d.score == null ? `${d.week_label}: no activity` : `${d.week_label}: ${d.score}`)).join(" · ")] as [string, string]] : []),
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {tiles.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-slate-700 p-3">
          <div className="text-xs text-slate-500">{label} this month</div>
          <div className="font-semibold">{value}</div>
        </div>
      ))}
    </div>
  );
}

function Walkthrough({ person, review, onSaved, onCancel }: { person: RosterRow; review: Review; onSaved: () => void; onCancel: () => void }) {
  const [step, setStep] = useState(1);
  const [metOn, setMetOn] = useState(today());
  const [areas, setAreas] = useState("");
  const [visits, setVisits] = useState<{ label: string; notes: string }[]>([]);
  const [visit, setVisit] = useState({ label: "", notes: "" });
  const [talk, setTalk] = useState<Record<string, string>>({});
  const [followUps, setFollowUps] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await hubPost("/api/one-on-ones", { employeeId: person.id, metOn, areasOfImprovement: areas, siteVisits: visits, followUps, ...talk });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  };

  const hasNotes = !!(areas.trim() || followUps.trim() || Object.values(talk).some((v) => v.trim()));
  return (
    <div className="glass-card rounded-2xl p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">1:1 with {person.name}</h2>
        <label className="text-sm">Meeting date <input type="date" className="ml-2 rounded-xl border border-slate-700 px-2 py-1" max={today()} value={metOn} onChange={(e) => setMetOn(e.target.value)} /></label>
      </div>
      <div className="flex gap-2 text-sm">
        {["Review", "Conversation", "Follow-ups"].map((s, i) => (
          <button key={s} type="button" aria-pressed={step === i + 1} onClick={() => setStep(i + 1)}
            className={`rounded-xl border px-3 py-1 ${step === i + 1 ? "btn-brand" : "border-slate-700 bg-slate-900/70"}`}>{i + 1}. {s}</button>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <ReviewNumbers r={review} />
          <div className="space-y-2">
            <div className="text-sm font-semibold">Site visits reviewed</div>
            {visits.map((v, i) => (
              <div key={i} className="flex items-start justify-between gap-2 rounded-xl border border-slate-700 p-2 text-sm">
                <div><span className="font-semibold">{v.label}</span>{v.notes ? `: ${v.notes}` : ""}</div>
                <button type="button" className="btn-text" onClick={() => setVisits(visits.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
            <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr_auto] gap-2">
              <input className={field} placeholder="Job / ticket #" value={visit.label} onChange={(e) => setVisit({ ...visit, label: e.target.value })} />
              <input className={field} placeholder="What you found" value={visit.notes} onChange={(e) => setVisit({ ...visit, notes: e.target.value })} />
              <button type="button" className="rounded-xl border border-slate-600 px-3 text-sm" disabled={!visit.label.trim() && !visit.notes.trim()}
                onClick={() => { setVisits([...visits, visit]); setVisit({ label: "", notes: "" }); }}>Add</button>
            </div>
          </div>
          <label className="block text-sm"><span className="font-semibold">Areas for improvement</span>
            <textarea className={`${field} mt-1`} rows={3} value={areas} onChange={(e) => setAreas(e.target.value)} /></label>
          <button type="button" className="btn-brand" onClick={() => setStep(2)}>Next: Conversation</button>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-3">
          {CONVERSATION.map((c) => (
            <label key={c.key} className="block text-sm"><span className="font-semibold">{c.label}</span>
              <textarea className={`${field} mt-1`} rows={3} value={talk[c.key] ?? ""} onChange={(e) => setTalk({ ...talk, [c.key]: e.target.value })} /></label>
          ))}
          <button type="button" className="btn-brand" onClick={() => setStep(3)}>Next: Follow-ups</button>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-3">
          <label className="block text-sm"><span className="font-semibold">Follow-ups</span> <span className="text-slate-500">(action items / commitments)</span>
            <textarea className={`${field} mt-1`} rows={4} value={followUps} onChange={(e) => setFollowUps(e.target.value)} /></label>
          {error && <div className="text-sm text-red-700">{error}</div>}
          {!confirming ? (
            <div className="flex gap-2">
              <button type="button" className="btn-brand" disabled={!hasNotes} onClick={() => setConfirming(true)}>{hasNotes ? "Save 1:1" : "Add some notes to save"}</button>
              <button type="button" className="rounded-xl border border-slate-600 px-4 py-2 text-sm" onClick={onCancel}>Cancel</button>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3 text-sm text-slate-200">
              <div>{person.name} will be able to read this 1:1. It can't be changed after saving. Save now?</div>
              <div className="flex gap-2">
                <button type="button" className="btn-brand" disabled={saving} onClick={save}>{saving ? "Saving…" : "Yes, save"}</button>
                <button type="button" className="rounded-xl border border-slate-600 px-4 py-2" onClick={() => setConfirming(false)}>Keep editing</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TeamTab() {
  const [roster, setRoster] = useState<{ month: string; people: RosterRow[] } | null>(null);
  const [selected, setSelected] = useState<RosterRow | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState("");
  const loadRoster = () => hubGet<{ month: string; people: RosterRow[] }>("/api/one-on-ones/roster").then(setRoster).catch((e: Error) => setError(e.message));
  const open = (p: RosterRow) => {
    setSelected(p);
    setLogging(false);
    setDetail(null);
    hubGet<Detail>(`/api/one-on-ones/employee/${p.id}`).then(setDetail).catch((e: Error) => setError(e.message));
  };
  useEffect(() => { void loadRoster(); }, []);

  if (error) return <div className="text-sm text-red-700">{error}</div>;
  if (!roster) return <div className="text-sm text-slate-500">Loading…</div>;
  if (selected) {
    return (
      <div className="space-y-4">
        <button type="button" className="btn-text" onClick={() => { setSelected(null); void loadRoster(); }}>← Back to team</button>
        {!detail ? <div className="text-sm text-slate-500">Loading…</div> : logging ? (
          <Walkthrough person={selected} review={detail.review} onCancel={() => setLogging(false)} onSaved={() => open(selected)} />
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-xl font-semibold">{selected.name}</h2>
              {detail.canWrite && <button type="button" className="btn-brand" onClick={() => setLogging(true)}>Log a 1:1</button>}
            </div>
            <ReviewNumbers r={detail.review} />
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 pt-2">Past 1:1s</div>
            {detail.history.length ? detail.history.map((m) => <MeetingCard key={m.id} m={m} />) : <div className="text-sm text-slate-500">No 1:1s logged yet.</div>}
          </>
        )}
      </div>
    );
  }
  const done = roster.people.filter((p) => p.done_this_month).length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">{done} of {roster.people.length} have a 1:1 logged this month.</p>
      <div className="glass-card rounded-2xl overflow-hidden">
        {roster.people.map((p) => (
          <button key={p.id} type="button" onClick={() => open(p)}
            className="flex w-full items-center justify-between gap-3 border-t border-slate-800 px-4 py-3 text-left first:border-t-0 hover:bg-slate-900/60">
            <div><div className="font-semibold">{p.name}</div><div className="text-xs text-slate-500">{p.departments || "—"}</div></div>
            <div className="text-right text-sm">
              <div>{p.done_this_month ? "✓ This month" : "— Not yet"}</div>
              <div className="text-xs text-slate-500">{p.last_met_on ? `Last: ${fmt(p.last_met_on)}` : "No 1:1s yet"}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function MineTab() {
  const [list, setList] = useState<Meeting[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { hubGet<Meeting[]>("/api/one-on-ones/mine").then(setList).catch((e: Error) => setError(e.message)); }, []);
  if (error) return <div className="text-sm text-red-700">{error}</div>;
  if (!list) return <div className="text-sm text-slate-500">Loading…</div>;
  if (!list.length) return <div className="glass-card rounded-2xl p-6 text-sm text-slate-500">No 1:1s logged with you yet.</div>;
  return <div className="space-y-3">{list.map((m) => <MeetingCard key={m.id} m={m} />)}</div>;
}

export default function OneOnOnePage() {
  const { me } = useMe();
  const canTeam = !!me?.permissions["one_on_ones.read"];
  const [tab, setTab] = useState<"team" | "mine" | null>(null);
  const active = tab ?? (canTeam ? "team" : "mine");
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">1:1s</h1>
      {canTeam && (
        <div className="flex gap-2" role="tablist">
          {([["team", "My team"], ["mine", "My 1:1s"]] as const).map(([key, name]) => (
            <button key={key} type="button" role="tab" aria-selected={active === key}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold ${active === key ? "btn-brand" : "border-slate-700 bg-slate-900/70"}`}
              onClick={() => setTab(key)}>{name}</button>
          ))}
        </div>
      )}
      {active === "team" && canTeam ? <TeamTab /> : <MineTab />}
    </div>
  );
}
