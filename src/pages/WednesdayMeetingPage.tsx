// Wednesday Meeting (managers, C-Suite, admins).
//   Meeting deck   the slides presented on the TV (components/MeetingDeck.tsx)
//   Schedule       each meeting's topic, presenting tech (picked from the employee list, never typed)
//                  and presentation link
import { useEffect, useState } from "react";
import { hubGet, hubPut } from "../lib/hubApi";
import MeetingDeck from "../components/MeetingDeck";
import PageTitle from "../components/PageTitle";

type Meeting = {
  id: string; date: string; topic: string; presenter_id: string | null; presenter: string | null;
  presenter_name_legacy: string | null; presentation_url: string | null; presentation_type: "slides" | "external" | null;
};
type Person = { id: string; name: string };

const field = "w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm";
const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const shiftDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

function MeetingRow({ m, people, onSaved }: { m: Meeting; people: Person[]; onSaved: (m: Meeting) => void }) {
  const [topic, setTopic] = useState(m.topic);
  const [url, setUrl] = useState(m.presentation_url ?? "");
  const [type, setType] = useState<"slides" | "external">(m.presentation_type ?? "slides");
  const [status, setStatus] = useState("");

  const save = async (patch: Record<string, unknown>) => {
    setStatus("Saving…");
    try {
      const saved = await hubPut<Meeting>("/api/meetings", { date: m.date, ...patch });
      onSaved(saved);
      setStatus("Saved");
      setTimeout(() => setStatus(""), 1500);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  return (
    <div className="border-t border-slate-800 p-4 first:border-t-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">{fmt(m.date)}</div>
        <div className={`text-xs ${status && status !== "Saved" && status !== "Saving…" ? "text-red-700" : "text-slate-500"}`}>{status}</div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_16rem] gap-2">
        <input className={field} placeholder="Topic" value={topic} onChange={(e) => setTopic(e.target.value)}
          onBlur={() => topic !== m.topic && void save({ topic })} />
        <select className={field} value={m.presenter_id ?? ""} onChange={(e) => void save({ presenterId: e.target.value || null })}>
          <option value="">{m.presenter_name_legacy ? `${m.presenter_name_legacy} (not in employee list)` : "No tech spotlight"}</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_10rem_auto] gap-2">
        <input className={field} placeholder="Presentation link (https://…)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <select className={field} value={type} onChange={(e) => setType(e.target.value as "slides" | "external")}>
          <option value="slides">Google Slides</option>
          <option value="external">Other link</option>
        </select>
        <button type="button" className="rounded-xl border border-slate-600 px-4 py-2 text-sm"
          disabled={url === (m.presentation_url ?? "") && type === (m.presentation_type ?? "slides")}
          onClick={() => void save({ presentationUrl: url.trim() || null, presentationType: type })}>{url.trim() ? "Save link" : "Remove link"}</button>
      </div>
    </div>
  );
}

function Schedule() {
  const [from, setFrom] = useState<string | null>(null);
  const [weeks, setWeeks] = useState(12);
  const [data, setData] = useState<{ from: string; meetings: Meeting[]; people: Person[] } | null>(null);
  const [newDate, setNewDate] = useState("");
  const [error, setError] = useState("");

  const load = () =>
    hubGet<{ from: string; meetings: Meeting[]; people: Person[] }>(`/api/meetings?weeks=${weeks}${from ? `&from=${from}` : ""}`)
      .then((d) => { setData(d); setError(""); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [from, weeks]);

  const add = async () => {
    try {
      await hubPut("/api/meetings", { date: newDate });
      setNewDate("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error && !data) return <div className="text-sm text-red-700">{error}</div>;
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center text-sm">
        <button type="button" className="rounded-xl border border-slate-700 px-3 py-1" onClick={() => setFrom(shiftDays(data.from, -7 * weeks))}>← Earlier</button>
        <button type="button" className="rounded-xl border border-slate-700 px-3 py-1" onClick={() => setFrom(null)}>From this week</button>
        <button type="button" className="rounded-xl border border-slate-700 px-3 py-1" onClick={() => setWeeks(weeks + 12)}>Show 12 more</button>
        <span className="ml-auto flex gap-2 items-center">
          <input type="date" className="rounded-xl border border-slate-700 px-2 py-1" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          <button type="button" className="btn-brand" disabled={!newDate} onClick={() => void add()}>Add meeting</button>
        </span>
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="glass-card rounded-2xl overflow-hidden">
        {data.meetings.length === 0 && <div className="p-4 text-sm text-slate-500">No meetings scheduled in this range.</div>}
        {data.meetings.map((m) => (
          <MeetingRow key={`${m.id}-${m.presenter_id}-${m.presentation_url}`} m={m} people={data.people}
            onSaved={(saved) => setData({ ...data, meetings: data.meetings.map((x) => (x.id === saved.id ? saved : x)) })} />
        ))}
      </div>
    </div>
  );
}

export default function WednesdayMeetingPage() {
  const [tab, setTab] = useState<"deck" | "schedule">("deck");
  return (
    <div className="space-y-4">
      <PageTitle title="Wednesday Meeting" />
      <div className="flex gap-2" role="tablist">
        {([["deck", "Meeting deck"], ["schedule", "Schedule"]] as const).map(([k, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${tab === k ? "btn-brand" : "border-slate-700 bg-slate-900/70"}`}>{n}</button>
        ))}
      </div>
      {tab === "deck" ? <MeetingDeck /> : <Schedule />}
    </div>
  );
}
