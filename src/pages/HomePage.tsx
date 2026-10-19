// Home (Levi, 2026-10-19): what's due this week, where you stand, what's new in Resources, then the
// tools as big icon tiles grouped like the Teamwix hub. The tiles are the main way around; the
// sidebar stays collapsed to icons. Each card reads its feature's own "mine" endpoint, so Home
// always agrees with the feature pages; each loads on its own, so one failing never blanks the page.
import { useEffect, useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ClipboardCheck, Palmtree, Sparkles, SprayCan, Star, Users } from "lucide-react";
import { hubGet, useMe } from "../lib/hubApi";
import { navFor } from "../lib/nav";
import { ResourceIcon, type Resource } from "./ResourcesPage";

function useData<T>(url: string | null) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    if (!url) return;
    let live = true;
    hubGet<T>(url).then((data) => live && setState({ data })).catch((e: Error) => live && setState({ error: e.message }));
    return () => { live = false; };
  }, [url]);
  return state;
}

type Status = "done" | "todo" | "pto" | "waiting";
const STATUS_STYLE: Record<Status, string> = {
  done: "text-emerald-600",
  todo: "text-amber-700",
  pto: "text-slate-500",
  waiting: "text-slate-500",
};

function DueCard({ icon: Icon, title, status, line, to, action }: {
  icon: ComponentType<{ className?: string }>; title: string; status: Status | null; line: string; to: string; action?: string;
}) {
  return (
    <div className="hub-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className="hub-icon-chip hub-icon-chip--sm"><Icon /></span>
        <span className="font-bold">{title}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm flex items-center gap-1.5 ${status ? STATUS_STYLE[status] : "text-slate-500"}`}>
          {status === "done" && <CheckCircle2 className="w-4 h-4 shrink-0" />}
          {status === "pto" && <Palmtree className="w-4 h-4 shrink-0" />}
          {status === null ? "Loading…" : line}
        </span>
        {action
          ? <Link to={to} className="btn-brand text-sm shrink-0 !min-w-0 !px-4 !py-1.5">{action}</Link>
          : <Link to={to} className="btn-text text-sm shrink-0">Open</Link>}
      </div>
    </div>
  );
}

type WeeklyMine = { current: unknown | null };
type AuditForm = { audit: { score: number | null } | null; onPto: boolean; locked: boolean; sections: { vehicle: boolean; office: boolean } };
type PeerList = { month: string; people: { done: boolean }[] };
type ScoreCard = { overall: number; streak: number; quarter: { label: string; points: number; level: { name: string; nextAt: number | null; nextName: string | null } } };
type TeamSummary = null | {
  people: number;
  weekly: { expected: number; missing: string[] };
  cleanliness: { expected: number; missing: string[] };
  oneOnOnes: { done: number; total: number };
};

function WeeklyCard() {
  const { data, error } = useData<WeeklyMine>("/api/weekly-reports/mine");
  if (error) return <DueCard icon={ClipboardCheck} title="Weekly Report" status="waiting" line="Couldn't load" to="/weekly-report" />;
  if (!data) return <DueCard icon={ClipboardCheck} title="Weekly Report" status={null} line="" to="/weekly-report" />;
  return data.current
    ? <DueCard icon={ClipboardCheck} title="Weekly Report" status="done" line="Submitted this week" to="/weekly-report" />
    : <DueCard icon={ClipboardCheck} title="Weekly Report" status="todo" line="Due this week" to="/weekly-report" action="Start" />;
}

function CleanlinessCard() {
  const { data, error } = useData<AuditForm>("/api/cleanliness/form");
  if (error) return <DueCard icon={SprayCan} title="Cleanliness Audit" status="waiting" line="Couldn't load" to="/cleanliness" />;
  if (!data) return <DueCard icon={SprayCan} title="Cleanliness Audit" status={null} line="" to="/cleanliness" />;
  if (!data.sections.vehicle && !data.sections.office) return null; // nothing to audit for this person
  if (data.audit) return <DueCard icon={SprayCan} title="Cleanliness Audit" status="done" line={`Done this week${data.audit.score != null ? ` · ${data.audit.score}%` : ""}`} to="/cleanliness" />;
  if (data.onPto) return <DueCard icon={SprayCan} title="Cleanliness Audit" status="pto" line="On PTO this week" to="/cleanliness" />;
  if (data.locked) return <DueCard icon={SprayCan} title="Cleanliness Audit" status="waiting" line="New week opens at 9am" to="/cleanliness" />;
  return <DueCard icon={SprayCan} title="Cleanliness Audit" status="todo" line="Due by Tuesday night" to="/cleanliness" action="Start" />;
}

function PeerCard() {
  const { data, error } = useData<PeerList>("/api/peer-assessments/assignments");
  if (error) return <DueCard icon={Star} title="Peer Assessments" status="waiting" line="Couldn't load" to="/peer-assessments" />;
  if (!data) return <DueCard icon={Star} title="Peer Assessments" status={null} line="" to="/peer-assessments" />;
  const done = data.people.filter((p) => p.done).length;
  const total = data.people.length;
  const month = new Date(`${data.month}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  if (!total) return null;
  return done >= total
    ? <DueCard icon={Star} title="Peer Assessments" status="done" line={`All ${total} done for ${month}`} to="/peer-assessments" />
    : <DueCard icon={Star} title="Peer Assessments" status="todo" line={`${done} of ${total} done for ${month}`} to="/peer-assessments" action={done ? "Continue" : "Start"} />;
}

function TeamCard() {
  const { data } = useData<TeamSummary>("/api/home/team");
  if (!data || !data.people) return null;
  const Row = ({ label, missing, expected }: { label: string; missing: string[]; expected: number }) => (
    <div className="text-sm">
      {missing.length
        ? <details><summary className="cursor-pointer text-amber-700">{label}: {missing.length} of {expected} not yet</summary>
            <div className="mt-1 text-slate-400">{missing.join(", ")}</div></details>
        : <div className="text-emerald-600 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" />{label}: all {expected} done</div>}
    </div>
  );
  return (
    <div className="hub-card p-4 space-y-2">
      <div className="flex items-center gap-3">
        <span className="hub-icon-chip hub-icon-chip--sm"><Users /></span>
        <span className="font-bold">Your team</span><span className="text-sm text-slate-500">{data.people} people</span>
      </div>
      <Row label="Weekly reports" missing={data.weekly.missing} expected={data.weekly.expected} />
      {data.cleanliness.expected > 0 && <Row label="Cleanliness audits" missing={data.cleanliness.missing} expected={data.cleanliness.expected} />}
      <div className="text-sm text-slate-400">1:1s this month: {data.oneOnOnes.done} of {data.oneOnOnes.total}</div>
      <div className="flex gap-3 pt-1">
        <Link to="/team-report" className="btn-text text-sm">Team Report</Link>
        <Link to="/one-on-ones" className="btn-text text-sm">1:1s</Link>
      </div>
    </div>
  );
}

function Stat({ to, label, value, sub }: { to: string; label: string; value: string; sub?: string }) {
  return (
    <Link to={to} className="hub-card px-4 py-3 transition-shadow hover:shadow-md">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xl font-black">{value}</div>
      {sub && <div className="text-xs text-slate-500 truncate">{sub}</div>}
    </Link>
  );
}

function Strip() {
  const score = useData<{ card: ScoreCard }>("/api/scorecard/me").data?.card;
  const points = useData<{ balance: number }>("/api/shop/points").data;
  const oneOnOnes = useData<{ met_on: string }[]>("/api/one-on-ones/mine").data;
  const last = oneOnOnes?.[0]?.met_on;
  const today = new Date();
  const from = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const to = new Date(today.getTime() + 100 * 864e5).toISOString().slice(0, 10);
  const calendar = useData<{ items: { kind: string; title: string; start: string }[] }>(`/api/calendar?from=${from}&to=${to}`).data;
  const holiday = calendar?.items.find((i) => i.kind === "holiday");
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <Stat to="/my-score" label="My score" value={score ? `${score.overall}%` : "…"}
        sub={score && score.streak > 0 ? `${score.streak}-month streak` : "This month"} />
      <Stat to="/my-score" label={score ? `${score.quarter.label} level` : "Level"} value={score?.quarter.level.name ?? "…"}
        sub={score ? `${score.quarter.points} pts${score.quarter.level.nextAt ? ` · ${score.quarter.level.nextAt - score.quarter.points} to ${score.quarter.level.nextName}` : ""}` : undefined} />
      <Stat to="/shop" label="Shop points" value={points ? points.balance.toLocaleString() : "…"} />
      <Stat to="/calendar" label="Next holiday" value={calendar === undefined ? "…" : holiday ? new Date(`${holiday.start}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "None yet"}
        sub={holiday?.title} />
      <Stat to="/one-on-ones" label="Last 1:1" value={oneOnOnes === undefined ? "…" : last ? new Date(`${last}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "None yet"} />
    </div>
  );
}

function NewInResources() {
  const items = useData<{ items: Resource[] }>("/api/resources").data?.items;
  if (!items) return null;
  const recent = items.filter((r) => Date.now() - new Date(r.updatedAt).getTime() < 7 * 864e5)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  if (!recent.length) return null;
  return (
    <section>
      <div className="hub-section-title"><Sparkles className="w-3.5 h-3.5" />New in Resources<Link to="/resources" className="ml-auto normal-case tracking-normal font-semibold btn-text text-xs">All resources</Link></div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {recent.map((r) => (
          <Link key={r.id} to={`/resources/${r.slug}`} className="hub-card p-3 flex gap-3 items-center transition-shadow hover:shadow-md">
            <span className="hub-icon-chip hub-icon-chip--sm"><ResourceIcon r={r} /></span>
            <span className="min-w-0"><span className="block text-sm font-semibold truncate">{r.title}</span>
              <span className="block text-xs text-slate-500">{r.category}</span></span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Tools() {
  const { me } = useMe();
  if (!me) return null;
  return (
    <>
      {navFor(me).map((g) => (
        <section key={g.id}>
          <div className="hub-section-title">{g.label}</div>
          <div className="hub-tiles">
            {g.items.map(({ to, label, icon: Icon, description }) => (
              <Link key={to} to={to} className="hub-tile" title={description}>
                <span className="hub-icon-chip hub-icon-chip--lg"><Icon /></span>
                <span className="hub-tile__name">{label}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function HomePage() {
  const { me } = useMe();
  const first = me?.employee?.first_name;
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{greeting()}{first ? `, ${first}` : ""}</h1>
        <p className="text-sm text-slate-500">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}{me?.employee ? ` · ${me.employee.company}` : ""}</p>
      </div>
      {me && !me.employee ? (
        <div className="hub-card p-6 text-sm text-slate-400">Your sign-in isn't linked to an employee profile yet. Ask an Onboarding Admin to add you.</div>
      ) : (
        <>
          <section>
            <div className="hub-section-title">Due this week</div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-start">
              <WeeklyCard />
              <CleanlinessCard />
              <PeerCard />
              <TeamCard />
            </div>
          </section>
          <Strip />
          <NewInResources />
          <Tools />
        </>
      )}
    </div>
  );
}
