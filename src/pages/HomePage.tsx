// Home: what's due this week, a slim strip of where you stand, what's new in Resources, and quick
// links (Levi, 2026-10-19). Each card reads its feature's own "mine" endpoint, so Home always agrees
// with the feature pages; each loads on its own, so one failing never blanks the page.
import { useEffect, useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen, CalendarDays, CheckCircle2, ClipboardCheck, ClipboardList, CreditCard, Flame, Lightbulb,
  MessagesSquare, Palmtree, ShoppingBag, Sparkles, SprayCan, Star, Trophy, Users,
} from "lucide-react";
import { hubGet, useMe } from "../lib/hubApi";
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
  done: "text-emerald-700",
  todo: "text-amber-700",
  pto: "text-slate-500",
  waiting: "text-slate-500",
};

function DueCard({ icon: Icon, title, status, line, to, action }: {
  icon: ComponentType<{ className?: string }>; title: string; status: Status | null; line: string; to: string; action?: string;
}) {
  return (
    <div className="glass-card rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2 font-semibold"><Icon className="w-5 h-5 text-slate-500" />{title}</div>
      <div className={`text-sm flex items-center gap-1.5 ${status ? STATUS_STYLE[status] : "text-slate-400"}`}>
        {status === "done" && <CheckCircle2 className="w-4 h-4" />}
        {status === "pto" && <Palmtree className="w-4 h-4" />}
        {status === null ? "Loading…" : line}
      </div>
      <div className="mt-auto">
        {action
          ? <Link to={to} className="btn-brand inline-block text-sm">{action}</Link>
          : <Link to={to} className="btn-text text-sm">Open</Link>}
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
            <div className="mt-1 text-slate-600">{missing.join(", ")}</div></details>
        : <div className="text-emerald-700 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" />{label}: all {expected} done</div>}
    </div>
  );
  return (
    <div className="glass-card rounded-2xl p-5 space-y-2 md:col-span-2 xl:col-span-1">
      <div className="flex items-center gap-2 font-semibold"><Users className="w-5 h-5 text-slate-500" />Your team <span className="text-sm font-normal text-slate-500">{data.people} people</span></div>
      <Row label="Weekly reports" missing={data.weekly.missing} expected={data.weekly.expected} />
      {data.cleanliness.expected > 0 && <Row label="Cleanliness audits" missing={data.cleanliness.missing} expected={data.cleanliness.expected} />}
      <div className="text-sm text-slate-600">1:1s this month: {data.oneOnOnes.done} of {data.oneOnOnes.total}</div>
      <div className="flex gap-3 pt-1">
        <Link to="/team-report" className="btn-text text-sm">Team Report</Link>
        <Link to="/one-on-ones" className="btn-text text-sm">1:1s</Link>
      </div>
    </div>
  );
}

function Stat({ to, label, value, sub }: { to: string; label: string; value: string; sub?: string }) {
  return (
    <Link to={to} className="glass-card rounded-2xl px-4 py-3 hover:shadow-md transition-shadow">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-black">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </Link>
  );
}

function Strip() {
  const score = useData<{ card: ScoreCard }>("/api/scorecard/me").data?.card;
  const points = useData<{ balance: number }>("/api/shop/points").data;
  const oneOnOnes = useData<{ met_on: string }[]>("/api/one-on-ones/mine").data;
  const last = oneOnOnes?.[0]?.met_on;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Stat to="/my-score" label="My score this month" value={score ? `${score.overall}%` : "…"}
        sub={score && score.streak > 0 ? `${score.streak}-month streak` : undefined} />
      <Stat to="/my-score" label={score ? `${score.quarter.label} level` : "Level"} value={score?.quarter.level.name ?? "…"}
        sub={score ? `${score.quarter.points} pts${score.quarter.level.nextAt ? ` · ${score.quarter.level.nextAt - score.quarter.points} to ${score.quarter.level.nextName}` : ""}` : undefined} />
      <Stat to="/shop" label="Shop points" value={points ? points.balance.toLocaleString() : "…"} />
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
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold inline-flex items-center gap-2"><Sparkles className="w-4 h-4" />New in Resources</h2>
        <Link to="/resources" className="btn-text text-sm">All resources</Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {recent.map((r) => (
          <Link key={r.id} to={`/resources/${r.slug}`} className="glass-card rounded-2xl p-3 flex gap-2 items-start hover:shadow-md transition-shadow">
            <ResourceIcon r={r} className="w-4 h-4 mt-0.5 text-slate-500" />
            <span className="min-w-0"><span className="block text-sm font-semibold truncate">{r.title}</span>
              <span className="block text-xs text-slate-500">{r.category}</span></span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function QuickLinks() {
  const { me } = useMe();
  const p = me?.permissions ?? {};
  const links: { to: string; label: string; icon: ComponentType<{ className?: string }>; show?: boolean }[] = [
    { to: "/resources", label: "Resources", icon: BookOpen },
    { to: "/my-score", label: "My Score", icon: Trophy },
    { to: "/shop", label: "Shop", icon: ShoppingBag },
    { to: "/people", label: "People", icon: Users },
    { to: "/one-on-ones", label: "1:1s", icon: MessagesSquare },
    { to: "/tech-spotlight", label: "Tech Spotlight", icon: Lightbulb },
    { to: "/credit-card", label: "Credit Card", icon: CreditCard },
    { to: "/team-report", label: "Team Report", icon: ClipboardList, show: !!p["reports.view_team"] },
    { to: "/wednesday-meeting", label: "Wednesday Meeting", icon: CalendarDays, show: !!p["meetings.manage"] },
  ];
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Quick links</h2>
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
        {links.filter((l) => l.show !== false).map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="glass-card rounded-xl p-3 flex flex-col items-center gap-1 text-center hover:shadow-md transition-shadow">
            <Icon className="w-5 h-5 text-slate-600" /><span className="text-xs">{label}</span>
          </Link>
        ))}
      </div>
    </section>
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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{greeting()}{first ? `, ${first}` : ""}</h1>
        <p className="text-sm text-slate-500">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
      </div>
      {me && !me.employee ? (
        <div className="glass-card rounded-2xl p-6 text-sm text-slate-600">Your sign-in isn't linked to an employee profile yet. Ask an Onboarding Admin to add you.</div>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Due this week</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <WeeklyCard />
              <CleanlinessCard />
              <PeerCard />
              <TeamCard />
            </div>
          </section>
          <Strip />
          <NewInResources />
          <QuickLinks />
        </>
      )}
    </div>
  );
}
