// The Wednesday Meeting deck. Every number comes from the same API the standalone page uses
// (cleanliness report, driver scorecard, credit card, spotlights, schedule), never a copy of its
// logic, so the deck and the reports can't drift apart (the Wix deck's PTO bug, 2026-08-25).
//
// Presenter mode = fullscreen + everything scaled up for the 1080p conference-room TV, read from the
// back row. ← / → step through the slides. Driver scores are horizontal bars with names on the left
// (the Wix vertical bars were unreadable on the TV, MEETING-BACKLOG #1).
import { useCallback, useEffect, useRef, useState } from "react";
import { hubGet, useUploadUrl } from "../lib/hubApi";
import { weeklyCoreValues, weeklyPrompt } from "../lib/coreValues";
import { DepartmentBars } from "../pages/CreditCardPage";
import { PARKED, RULES } from "../pages/DriverScorecardPage";

type Meeting = { id: string; date: string; topic: string; presenter: string | null; presenter_name_legacy: string | null; presentation_url: string | null; presentation_type: "slides" | "external" | null };
type Spotlight = { id: string; title: string; problem: string; solution: string; slides_url: string | null; photos: { uploadId: string; caption: string }[]; presenter: string };
type CleanPerson = { id: string; name: string; branch: string | null; status: "submitted" | "pto" | "missing"; score: number | null };
type Driver = { id: string; name: string | null; vehicle_label: string; score: number | null; is_parked: boolean; parked_reason: string | null } & Record<string, unknown>;
type DriverWeek = { week_label: string; fleet_score: number | null; rows: Driver[]; ruleAverages: Record<string, number | null> } | null;
type Credit = { week: string; company: { percent: number | null; receipts: number; purchases: number }; departments: { department: string; purchases: number; receipts: number; people: number; percent: number | null }[] } | null;

const SLIDES = [
  { key: "upcoming", label: "Upcoming" },
  { key: "positive", label: "One Positive Thing" },
  { key: "values", label: "Core Values" },
  { key: "cleanliness", label: "Cleanliness" },
  { key: "drivers", label: "Driver Scorecard" },
  { key: "credit", label: "Credit Card" },
  { key: "spotlight", label: "Tech Spotlight" },
  { key: "agenda", label: "Agenda" },
] as const;

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/** Google Slides "…/edit" link → embeddable "…/embed". */
const slidesEmbed = (url: string) => {
  const m = /docs\.google\.com\/presentation\/d\/([^/]+)/.exec(url);
  return m ? `https://docs.google.com/presentation/d/${m[1]}/embed?start=false&loop=false` : url;
};

function Photo({ id, caption }: { id: string; caption: string }) {
  const url = useUploadUrl(id);
  return (
    <figure className="space-y-1">
      {url ? <img src={url} alt={caption} className="h-56 w-full rounded-xl object-cover" /> : <div className="h-56 rounded-xl bg-slate-200/60" />}
      {caption && <figcaption className="text-sm text-slate-500">{caption}</figcaption>}
    </figure>
  );
}

function HBar({ label, sub, value, max = 100, muted }: { label: string; sub?: string; value: number | null; max?: number; muted?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(9rem,14rem)_1fr_4.5rem] items-center gap-4">
      <div className="truncate"><span className="font-semibold">{label}</span>{sub && <span className="text-slate-500"> {sub}</span>}</div>
      <div className="h-4 rounded-full bg-slate-200/70 overflow-hidden">
        {value != null && <div className="h-full rounded-full" style={{ width: `${(value / max) * 100}%`, background: muted ? "var(--theme-brand-secondary-400, #94a3b8)" : "var(--theme-accent-600, #2563eb)" }} />}
      </div>
      <div className="text-right font-bold tabular-nums">{value ?? "—"}</div>
    </div>
  );
}

export default function MeetingDeck() {
  const [meetingDate, setMeetingDate] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [spotlights, setSpotlights] = useState<Spotlight[] | null>(null);
  const [clean, setClean] = useState<CleanPerson[] | null>(null);
  const [drivers, setDrivers] = useState<DriverWeek | undefined>(undefined);
  const [credit, setCredit] = useState<Credit | undefined>(undefined);
  const [i, setI] = useState(0);
  const [presenter, setPresenter] = useState(false);
  const deckRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const today = todayLocal();
    hubGet<{ meetings: Meeting[] }>(`/api/meetings?from=${addDays(today, -7)}&weeks=6`).then((d) => {
      const next = d.meetings.find((m) => m.date >= today);
      const date = next?.date ?? today;
      setMeetingDate(date);
      setMeetings(d.meetings.filter((m) => m.date >= date));
    }).catch(() => setMeetingDate(today));
  }, []);
  useEffect(() => {
    if (!meetingDate) return;
    // The cleanliness week under review is the one that closed the night before the meeting.
    hubGet<{ people: CleanPerson[] }>(`/api/cleanliness/report?week=${addDays(meetingDate, -7)}`).then((d) => setClean(d.people)).catch(() => setClean([]));
    hubGet<Spotlight[]>(`/api/spotlights/meeting?date=${meetingDate}`).then(setSpotlights).catch(() => setSpotlights([]));
    hubGet<DriverWeek>("/api/driver-scorecard/week").then(setDrivers).catch(() => setDrivers(null));
    hubGet<Credit>("/api/credit-card/report").then(setCredit).catch(() => setCredit(null));
  }, [meetingDate]);

  const go = useCallback((d: number) => setI((x) => Math.max(0, Math.min(SLIDES.length - 1, x + d))), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);
  useEffect(() => {
    const onFs = () => setPresenter(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const togglePresenter = () => (document.fullscreenElement ? document.exitFullscreen() : deckRef.current?.requestFullscreen());

  if (!meetingDate) return <div className="text-sm text-slate-500">Loading…</div>;
  const meeting = meetings.find((m) => m.date === meetingDate) ?? null;
  const slide = SLIDES[i].key;

  const body = () => {
    switch (slide) {
      case "upcoming":
        return (
          <div className="space-y-3">
            {meetings.slice(0, 5).map((m) => (
              <div key={m.id} className={`rounded-2xl border p-5 ${m.date === meetingDate ? "border-slate-400" : "border-slate-200"}`}>
                <div className="text-sm text-slate-500">{fmt(m.date)}{m.date === meetingDate ? " · today" : ""}</div>
                <div className="text-2xl font-bold">{m.topic || "Weekly meeting"}</div>
                <div className="text-slate-600">Tech Spotlight: {m.presenter ?? m.presenter_name_legacy ?? "—"}</div>
              </div>
            ))}
            {!meetings.length && <div className="text-slate-500">Nothing on the schedule yet.</div>}
          </div>
        );
      case "positive":
        return (
          <div className="mx-auto max-w-3xl rounded-3xl border border-amber-200 bg-amber-50/70 p-12 text-center space-y-4 text-slate-800">
            <div className="text-6xl">🌟</div>
            <div className="text-4xl font-black">One Positive Thing</div>
            <p className="text-2xl">{weeklyPrompt(meetingDate)}</p>
          </div>
        );
      case "values":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {weeklyCoreValues(meetingDate).map((v) => (
              <div key={v.value} className="rounded-3xl border border-slate-200 p-10 space-y-3">
                <div className="text-xl text-slate-500">{v.trait}</div>
                <div className="text-5xl font-black">{v.value}</div>
                <p className="text-xl leading-relaxed">{v.desc}</p>
              </div>
            ))}
          </div>
        );
      case "cleanliness": {
        if (!clean) return <div className="text-slate-500">Loading…</div>;
        const submitted = clean.filter((p) => p.status === "submitted");
        const missing = clean.filter((p) => p.status === "missing");
        const avg = submitted.length ? Math.round(submitted.reduce((s, p) => s + (p.score ?? 0), 0) / submitted.length) : null;
        const branches = [...new Set(clean.map((p) => p.branch ?? "—"))].sort().map((b) => {
          const list = submitted.filter((p) => (p.branch ?? "—") === b);
          return { b, avg: list.length ? Math.round(list.reduce((s, p) => s + (p.score ?? 0), 0) / list.length) : null, n: list.length };
        });
        return (
          <div className="space-y-6">
            <div className="text-slate-500">Week of {fmt(addDays(meetingDate, -7))} – {fmt(addDays(meetingDate, -1))}</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[["Average", avg == null ? "—" : `${avg}%`], ["Submitted", submitted.length], ["Missing", missing.length], ["PTO", clean.filter((p) => p.status === "pto").length]].map(([l, v]) => (
                <div key={l} className="rounded-2xl border border-slate-200 p-5"><div className="text-slate-500">{l}</div><div className="text-4xl font-black">{v}</div></div>
              ))}
            </div>
            <div className="space-y-3">{branches.map((x) => <HBar key={x.b} label={x.b} sub={`(${x.n})`} value={x.avg} />)}</div>
            {missing.length > 0 && <div className="text-slate-600"><span className="font-semibold">Missing:</span> {missing.map((p) => p.name).join(", ")}</div>}
          </div>
        );
      }
      case "drivers": {
        if (drivers === undefined) return <div className="text-slate-500">Loading…</div>;
        if (!drivers) return <div className="text-slate-500">No driver scorecard uploaded yet.</div>;
        const ranked = drivers.rows.filter((r) => !r.is_parked);
        return (
          <div className="space-y-6">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <div className="text-slate-500">{drivers.week_label}</div>
              <div className="text-2xl">Fleet <span className="font-black text-4xl">{drivers.fleet_score?.toFixed(1) ?? "—"}</span></div>
            </div>
            <div className="space-y-2">{ranked.map((r) => <HBar key={r.id} label={r.name || `Van ${r.vehicle_label}`} sub={`#${r.vehicle_label}`} value={r.score} />)}</div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {RULES.map(([k, l]) => (
                <div key={k} className="rounded-2xl border border-slate-200 p-4"><div className="text-sm text-slate-500">{l}</div><div className="text-2xl font-bold">{drivers.ruleAverages[k] ?? "—"}</div></div>
              ))}
            </div>
            {drivers.rows.some((r) => r.is_parked) && (
              <div className="text-slate-500">Parked: {drivers.rows.filter((r) => r.is_parked).map((r) => `${r.name || `Van ${r.vehicle_label}`} (${PARKED[r.parked_reason ?? ""] ?? r.parked_reason})`).join(", ")}</div>
            )}
          </div>
        );
      }
      case "credit":
        if (credit === undefined) return <div className="text-slate-500">Loading…</div>;
        if (!credit) return <div className="text-slate-500">No receipt data synced yet.</div>;
        return (
          <div className="space-y-6">
            <div className="text-2xl">Company <span className="text-5xl font-black">{credit.company.percent ?? "—"}%</span> <span className="text-slate-500 text-lg">({credit.company.receipts} of {credit.company.purchases} receipts, last 28 days)</span></div>
            <div className="text-lg"><DepartmentBars departments={credit.departments} /></div>
          </div>
        );
      case "spotlight": {
        if (!spotlights) return <div className="text-slate-500">Loading…</div>;
        if (!spotlights.length) return <div className="text-slate-500">No Tech Spotlight submitted for this meeting{meeting?.presenter ? ` (scheduled: ${meeting.presenter})` : ""}.</div>;
        return (
          <div className="space-y-10">
            {spotlights.map((s) => (
              <div key={s.id} className="space-y-4">
                <div><div className="text-4xl font-black">{s.title}</div><div className="text-xl text-slate-500">{s.presenter}</div></div>
                {s.slides_url ? (
                  <iframe title={s.title} src={slidesEmbed(s.slides_url)} className="w-full aspect-video rounded-2xl border border-slate-200" allowFullScreen />
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xl">
                      <div className="rounded-2xl border border-slate-200 p-5"><div className="text-sm text-slate-500">Problem</div><div className="whitespace-pre-wrap">{s.problem}</div></div>
                      <div className="rounded-2xl border border-slate-200 p-5"><div className="text-sm text-slate-500">Solution</div><div className="whitespace-pre-wrap">{s.solution}</div></div>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">{s.photos.map((p) => <Photo key={p.uploadId} id={p.uploadId} caption={p.caption} />)}</div>
                  </>
                )}
              </div>
            ))}
          </div>
        );
      }
      case "agenda":
        if (!meeting) return <div className="text-slate-500">No meeting on the schedule for {fmt(meetingDate)}.</div>;
        return (
          <div className="space-y-4">
            <div className="text-4xl font-black">{meeting.topic || "Weekly meeting"}</div>
            {meeting.presentation_url && meeting.presentation_type === "slides" && (
              <iframe title="Agenda slides" src={slidesEmbed(meeting.presentation_url)} className="w-full aspect-video rounded-2xl border border-slate-200" allowFullScreen />
            )}
            {meeting.presentation_url && meeting.presentation_type !== "slides" && (
              <a href={meeting.presentation_url} target="_blank" rel="noreferrer" className="btn-brand inline-block">Open the presentation ↗</a>
            )}
            {!meeting.presentation_url && <div className="text-slate-500">No presentation link yet. Add one on the Schedule tab.</div>}
          </div>
        );
    }
  };

  return (
    <div ref={deckRef} className={presenter ? "bg-[var(--theme-page-bg,#f8fafc)] overflow-y-auto h-screen p-10" : ""}>
      <div style={presenter ? { zoom: 1.6 } : undefined} className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm text-slate-500">Wednesday Meeting · {fmt(meetingDate)}</div>
            <h2 className="text-3xl font-black">{SLIDES[i].label}</h2>
          </div>
          <div className="flex gap-2">
            <button type="button" className="rounded-xl border border-slate-300 px-3 py-2" disabled={i === 0} onClick={() => go(-1)} aria-label="Previous slide">←</button>
            <button type="button" className="rounded-xl border border-slate-300 px-3 py-2" disabled={i === SLIDES.length - 1} onClick={() => go(1)} aria-label="Next slide">→</button>
            <button type="button" className="btn-brand" onClick={() => void togglePresenter()}>{presenter ? "Exit presenter mode" : "Presenter mode"}</button>
          </div>
        </div>
        <div className="flex gap-1 flex-wrap">
          {SLIDES.map((s, n) => (
            <button key={s.key} type="button" onClick={() => setI(n)} aria-current={n === i}
              className={`rounded-full px-3 py-1 text-xs ${n === i ? "btn-brand" : "border border-slate-200 text-slate-500"}`}>{s.label}</button>
          ))}
        </div>
        <div className="glass-card rounded-3xl p-8">{body()}</div>
      </div>
    </div>
  );
}
