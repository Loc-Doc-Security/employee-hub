// My Score: the monthly scorecard, quarterly level, streak and badges. "Team scores" is a secondary
// view (rank, name, overall, level only), not front and center (Levi, 2026-10-16). Managers,
// Operations and C-Suite can open someone's full card from it.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { hubGet } from "../lib/hubApi";
import PageTitle from "../components/PageTitle";

type Item = { done: boolean; count: number; owed?: number };
type Card = {
  month: string; overall: number; points: number; participation: number;
  items: { weeklyReport: Item; peerAssessment: Item; cleanliness: Item };
  peerReceivedAvg: number | null; cleanlinessAvg: number | null; ptoWeeks: string[];
  streak: number; badges: { key: string; label: string; emoji: string }[];
  quarter: { label: string; points: number; level: { name: string; min: number; nextAt: number | null; nextName: string | null } };
  recent: { month: string; overall: number; participation: number }[];
  driver?: { week_label: string; score: number | null; is_parked: boolean; fleet_score: number | null }[];
};
type TeamRow = { rank: number; id: string; name: string; overall: number; level: string; isMe: boolean };

const fmtMonth = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const fmtShort = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const shiftMonth = (m: string, n: number) => {
  const d = new Date(`${m}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};
const thisMonth = () => new Date().toISOString().slice(0, 7);

function Bar({ value }: { value: number }) {
  return (
    <div className="h-2 rounded-full bg-slate-700/70 overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: "var(--theme-accent-600, #2563eb)" }} />
    </div>
  );
}

export function ScoreCard({ card }: { card: Card }) {
  const lvl = card.quarter.level;
  const toNext = lvl.nextAt ? Math.round(((card.quarter.points - lvl.min) / (lvl.nextAt - lvl.min)) * 100) : 100;
  const items = [
    { label: "Weekly Reports", to: "/weekly-report", i: card.items.weeklyReport, detail: `${card.items.weeklyReport.count} of ${card.items.weeklyReport.owed} weeks` },
    { label: "Peer Assessment", to: "/peer-assessments", i: card.items.peerAssessment, detail: `${card.items.peerAssessment.count} given` },
    { label: "Cleanliness Audit", to: "/cleanliness", i: card.items.cleanliness, detail: `${card.items.cleanliness.count} of ${card.items.cleanliness.owed} weeks` },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card rounded-2xl p-6 text-center">
          <div className="text-xs text-slate-500">Overall · {fmtMonth(card.month)}</div>
          <div className="text-5xl font-black my-1">{card.overall}%</div>
          <div className="text-sm text-slate-500">{card.participation} of 3 submitted</div>
        </div>
        <div className="glass-card rounded-2xl p-6 space-y-2">
          <div className="text-xs text-slate-500">{card.quarter.label} level</div>
          <div className="text-2xl font-bold">{lvl.name}</div>
          <Bar value={toNext} />
          <div className="text-xs text-slate-500">
            {card.quarter.points} points{lvl.nextAt ? ` · ${lvl.nextAt - card.quarter.points} to ${lvl.nextName}` : " · top level"}. Resets each quarter.
          </div>
        </div>
        <div className="glass-card rounded-2xl p-6 space-y-2">
          <div className="text-xs text-slate-500">Streak</div>
          <div className="text-2xl font-bold">{card.streak} month{card.streak === 1 ? "" : "s"}</div>
          <div className="flex flex-wrap gap-2">
            {card.badges.length ? card.badges.map((b) => (
              <span key={b.key} className="rounded-full border border-slate-700 px-3 py-1 text-xs">{b.emoji} {b.label}</span>
            )) : <span className="text-xs text-slate-500">No badges this month yet.</span>}
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl p-6 space-y-3">
        <div className="font-semibold">Submissions</div>
        {items.map(({ label, to, i, detail }) => (
          <div key={label} className="flex items-center justify-between gap-3 text-sm">
            <Link to={to} className="hover:underline">{label}</Link>
            <span className={i.done ? "font-semibold" : "text-slate-500"}>{i.done ? "✓ Done" : "Not yet"} · {detail}</span>
          </div>
        ))}
        {card.ptoWeeks.length > 0 && (
          <div className="text-xs text-slate-500">PTO: week{card.ptoWeeks.length > 1 ? "s" : ""} of {card.ptoWeeks.map(fmtDay).join(", ")}. Not counted against you.</div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card rounded-2xl p-6 space-y-2">
          <div className="flex justify-between"><span className="font-semibold">Peer assessments</span><span className="font-semibold">{card.peerReceivedAvg?.toFixed(2) ?? "—"} / 4</span></div>
          <Bar value={card.peerReceivedAvg != null ? (card.peerReceivedAvg / 4) * 100 : 0} />
          <div className="text-xs text-slate-500">{card.peerReceivedAvg != null ? "Average from teammates this month" : "No assessments received yet this month"}</div>
        </div>
        <div className="glass-card rounded-2xl p-6 space-y-2">
          <div className="flex justify-between"><span className="font-semibold">Cleanliness</span><span className="font-semibold">{card.cleanlinessAvg ?? "—"}%</span></div>
          <Bar value={card.cleanlinessAvg ?? 0} />
          <div className="text-xs text-slate-500">Average of this month's finished audit weeks (a missed week counts as 0)</div>
        </div>
      </div>

      {card.driver && card.driver.length > 0 && (
        <div className="glass-card rounded-2xl p-6 space-y-2">
          <div className="flex justify-between"><span className="font-semibold">Driver score</span><span className="text-xs text-slate-500">For reference, not part of your score</span></div>
          {card.driver.map((d) => (
            <div key={d.week_label} className="flex justify-between text-sm">
              <span>{d.week_label}</span>
              <span>{d.score == null ? "No activity" : <><span className="font-semibold">{d.score}</span>{d.fleet_score != null && <span className="text-slate-500"> · fleet {d.fleet_score.toFixed(1)}</span>}</>}</span>
            </div>
          ))}
        </div>
      )}

      <div className="glass-card rounded-2xl p-6">
        <div className="font-semibold mb-3">Last 6 months</div>
        <div className="grid grid-cols-6 gap-2 items-end h-28">
          {[...card.recent].reverse().map((m) => (
            <div key={m.month} className="flex flex-col items-center gap-1 h-full justify-end" title={`${fmtMonth(m.month)}: ${m.overall}%`}>
              <span className="text-xs font-semibold">{m.overall}%</span>
              <div className="w-full max-w-10 rounded-t" style={{ height: `${Math.max(4, m.overall * 0.7)}%`, background: "var(--theme-accent-600, #2563eb)" }} />
              <span className="text-xs text-slate-500">{fmtShort(m.month)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TeamScores({ month }: { month: string }) {
  const [data, setData] = useState<{ scope: string; canOpen: boolean; people: TeamRow[] } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [card, setCard] = useState<{ name: string; card: Card } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    hubGet<{ scope: string; canOpen: boolean; people: TeamRow[] }>(`/api/scorecard/team?month=${month}`).then(setData).catch((e: Error) => setError(e.message));
  }, [month]);
  useEffect(() => {
    if (!openId) return setCard(null);
    hubGet<{ name: string; card: Card }>(`/api/scorecard/employee/${openId}?month=${month}`).then(setCard).catch((e: Error) => setError(e.message));
  }, [openId, month]);

  if (error) return <div className="text-sm text-red-700">{error}</div>;
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  if (openId && card) {
    return (
      <div className="space-y-3">
        <button type="button" className="btn-text" onClick={() => setOpenId(null)}>← Back to team scores</button>
        <h2 className="text-xl font-semibold">{card.name}</h2>
        <ScoreCard card={card.card} />
      </div>
    );
  }
  return (
    <div className="glass-card rounded-2xl overflow-x-auto">
      <div className="p-3 text-xs text-slate-500">{data.scope === "department" ? "Your department" : "Your team"} · overall score and quarterly level</div>
      <table className="w-full text-sm">
        <tbody>
          {data.people.map((p) => (
            <tr key={p.id} className={`border-t border-slate-800 ${p.isMe ? "font-semibold" : ""}`}>
              <td className="p-3 w-10 text-slate-500">{p.rank}</td>
              <td className="p-3">
                {data.canOpen && !p.isMe ? <button type="button" className="hover:underline" onClick={() => setOpenId(p.id)}>{p.name}</button> : p.name}
                {p.isMe && <span className="ml-2 text-xs text-slate-500">(you)</span>}
              </td>
              <td className="p-3">{p.overall}%</td>
              <td className="p-3 text-slate-500">{p.level}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MyScorePage() {
  const [month, setMonth] = useState(thisMonth());
  const [card, setCard] = useState<Card | null>(null);
  const [showTeam, setShowTeam] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setCard(null);
    hubGet<{ card: Card }>(`/api/scorecard/me?month=${month}`).then((d) => setCard(d.card)).catch((e: Error) => setError(e.message));
  }, [month]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <PageTitle title="My Score">
          <div className="flex items-center gap-2 text-sm mt-1">
            <button type="button" className="rounded-xl border border-slate-700 px-3 py-1" onClick={() => setMonth(shiftMonth(month, -1))}>← Prev</button>
            <span className="font-semibold">{fmtMonth(month)}</span>
            <button type="button" className="rounded-xl border border-slate-700 px-3 py-1" disabled={month >= thisMonth()} onClick={() => setMonth(shiftMonth(month, 1))}>Next →</button>
          </div>
        </PageTitle>
        <button type="button" aria-pressed={showTeam} onClick={() => setShowTeam(!showTeam)}
          className={`rounded-xl border px-4 py-2 text-sm ${showTeam ? "btn-brand" : "border-slate-600"}`}>{showTeam ? "Back to my score" : "Team scores"}</button>
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
      {showTeam ? <TeamScores month={month} /> : card ? <ScoreCard card={card} /> : !error && <div className="text-sm text-slate-500">Loading…</div>}
    </div>
  );
}
