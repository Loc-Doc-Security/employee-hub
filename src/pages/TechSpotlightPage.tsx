// Tech Spotlight.
//   My spotlight   the scheduled presenter fills it in (autosaved), submits, and can keep editing
//                  until meeting day ends; locked after.
//   Showcase       everyone browses presented spotlights.
//   File for someone   super admin only: any tech, any date, any time.
import { useEffect, useRef, useState } from "react";
import { hubGet, hubPut, hubUpload, shrinkImage, useUploadUrl } from "../lib/hubApi";

type Photo = { uploadId: string; caption: string };
type Spotlight = {
  id: string; employee_id: string; presented_on: string; title: string; problem: string; solution: string;
  slides_url: string | null; photos: Photo[]; status: "draft" | "submitted"; presenter: string;
};
type Mine = { today: string; meeting: { id: string; date: string; topic: string } | null; spotlight: Spotlight | null; past: Spotlight[]; canFileForAnyone: boolean };

const field = "w-full rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm";
const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

function Img({ id, alt, className }: { id: string; alt: string; className: string }) {
  const url = useUploadUrl(id);
  return url ? <img src={url} alt={alt} className={className} /> : <div className={`${className} bg-slate-200/60`} />;
}

function SpotlightView({ s }: { s: Spotlight }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xl font-bold">{s.title || "Untitled"}</div>
        <div className="text-sm text-slate-500">{s.presenter} · {fmt(s.presented_on)}</div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border border-slate-200 p-3"><div className="text-xs text-slate-500">Problem</div><div className="whitespace-pre-wrap">{s.problem}</div></div>
        <div className="rounded-xl border border-slate-200 p-3"><div className="text-xs text-slate-500">Solution</div><div className="whitespace-pre-wrap">{s.solution}</div></div>
      </div>
      {s.photos.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {s.photos.map((p) => (
            <figure key={p.uploadId} className="space-y-1">
              <Img id={p.uploadId} alt={p.caption || s.title} className="h-40 w-full rounded-xl object-cover" />
              {p.caption && <figcaption className="text-xs text-slate-500">{p.caption}</figcaption>}
            </figure>
          ))}
        </div>
      )}
      {s.slides_url && <a href={s.slides_url} target="_blank" rel="noreferrer" className="btn-text">Open slides ↗</a>}
    </div>
  );
}

/** The editor. `onBehalf` = super admin filing for { employeeId, date }. */
function SpotlightForm({ initial, onBehalf, deadline }: { initial: Spotlight | null; onBehalf?: { employeeId: string; date: string }; deadline: string }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [problem, setProblem] = useState(initial?.problem ?? "");
  const [solution, setSolution] = useState(initial?.solution ?? "");
  const [slides, setSlides] = useState(initial?.slides_url ?? "");
  const [photos, setPhotos] = useState<Photo[]>(initial?.photos ?? []);
  const [uploading, setUploading] = useState(0);
  const [status, setStatus] = useState<"draft" | "submitted">(initial?.status ?? "draft");
  const [note, setNote] = useState(initial ? "Loaded your saved spotlight." : "");
  const [error, setError] = useState("");
  const first = useRef(true);

  const payload = (submit: boolean) => ({ title, problem, solution, slidesUrl: slides, photos, submit, ...(onBehalf ?? {}) });
  const save = async (submit: boolean) => {
    try {
      const saved = await hubPut<Spotlight>("/api/spotlights", payload(submit));
      setStatus(saved.status);
      setError("");
      setNote(submit ? "Submitted. You can keep editing until the meeting." : `${saved.status === "submitted" ? "Changes saved" : "Draft saved"} ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  // Autosave 2s after the last change.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (uploading) return;
    const t = setTimeout(() => void save(false), 2000);
    return () => clearTimeout(t);
  }, [title, problem, solution, slides, photos, uploading]);

  const addPhotos = async (files: FileList) => {
    for (const file of Array.from(files)) { // one at a time, in pick order
      setUploading((n) => n + 1);
      try {
        const id = await hubUpload(await shrinkImage(file).catch(() => file), "spotlight");
        setPhotos((p) => [...p, { uploadId: id, caption: "" }]);
      } catch (e) {
        setError(`A photo didn't upload: ${(e as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const move = (i: number, d: number) => setPhotos((p) => {
    const next = [...p];
    const [x] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, x);
    return next;
  });

  return (
    <div className="glass-card rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-slate-600">
          {status === "submitted" ? "✓ Submitted" : "Draft (not shown at the meeting until you submit)"} · editable through {fmt(deadline)}
        </div>
        <div className={`text-xs ${error ? "text-red-700" : "text-slate-500"}`}>{error || note}</div>
      </div>
      <label className="block text-sm"><span className="font-semibold">Title</span>
        <input className={`${field} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Rekeying a stuck mortise cylinder" /></label>
      <label className="block text-sm"><span className="font-semibold">The problem</span>
        <textarea className={`${field} mt-1`} rows={4} value={problem} onChange={(e) => setProblem(e.target.value)} /></label>
      <label className="block text-sm"><span className="font-semibold">How you solved it</span>
        <textarea className={`${field} mt-1`} rows={4} value={solution} onChange={(e) => setSolution(e.target.value)} /></label>
      <div className="space-y-2">
        <div className="text-sm font-semibold">Photos <span className="font-normal text-slate-500">(shown in this order)</span></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {photos.map((p, i) => (
            <div key={p.uploadId} className="rounded-xl border border-slate-200 p-2 space-y-2">
              <Img id={p.uploadId} alt={p.caption || `Photo ${i + 1}`} className="h-36 w-full rounded-lg object-cover" />
              <input className={field} placeholder="Caption" value={p.caption}
                onChange={(e) => setPhotos((all) => all.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))} />
              <div className="flex gap-2 text-xs">
                <button type="button" className="btn-text" disabled={i === 0} onClick={() => move(i, -1)}>↑ Earlier</button>
                <button type="button" className="btn-text" disabled={i === photos.length - 1} onClick={() => move(i, 1)}>↓ Later</button>
                <button type="button" className="btn-text ml-auto" onClick={() => setPhotos((all) => all.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
        <label className="inline-block cursor-pointer rounded-xl border border-dashed border-slate-300 px-4 py-2 text-sm">
          {uploading ? `Uploading ${uploading}…` : "+ Add photos"}
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) void addPhotos(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
      <label className="block text-sm"><span className="font-semibold">Google Slides link</span> <span className="text-slate-500">(optional; shown instead of the photos)</span>
        <input className={`${field} mt-1`} value={slides} onChange={(e) => setSlides(e.target.value)} placeholder="https://docs.google.com/presentation/…" /></label>
      {status === "draft" && (
        <button type="button" className="btn-brand" disabled={!!uploading || !title.trim() || !problem.trim() || !solution.trim()} onClick={() => void save(true)}>
          {title.trim() && problem.trim() && solution.trim() ? "Submit spotlight" : "Add a title, problem and solution to submit"}
        </button>
      )}
    </div>
  );
}

function MyTab({ mine }: { mine: Mine }) {
  return (
    <div className="space-y-4">
      {mine.meeting ? (
        <>
          <p className="text-sm text-slate-600">You're presenting on <span className="font-semibold">{fmt(mine.meeting.date)}</span>{mine.meeting.topic ? ` (${mine.meeting.topic})` : ""}.</p>
          <SpotlightForm initial={mine.spotlight} deadline={mine.meeting.date} />
        </>
      ) : (
        <div className="glass-card rounded-2xl p-6 text-sm">You're not scheduled to present at an upcoming meeting. When a manager puts you on the schedule, your spotlight form appears here.</div>
      )}
      {mine.past.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your past spotlights</div>
          {mine.past.map((s) => <div key={s.id} className="glass-card rounded-2xl p-5"><SpotlightView s={s} /></div>)}
        </div>
      )}
    </div>
  );
}

function Showcase() {
  const [list, setList] = useState<Spotlight[] | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Spotlight | null>(null);
  useEffect(() => { hubGet<Spotlight[]>("/api/spotlights/showcase").then(setList).catch(() => setList([])); }, []);
  if (!list) return <div className="text-sm text-slate-500">Loading…</div>;
  if (open) return <div className="space-y-3"><button type="button" className="btn-text" onClick={() => setOpen(null)}>← Back to showcase</button><div className="glass-card rounded-2xl p-6"><SpotlightView s={open} /></div></div>;
  const s = search.trim().toLowerCase();
  const shown = s ? list.filter((x) => `${x.title} ${x.presenter} ${x.problem} ${x.solution}`.toLowerCase().includes(s)) : list;
  return (
    <div className="space-y-3">
      <input className={field} placeholder="Search spotlights" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {shown.map((x) => (
          <button key={x.id} type="button" onClick={() => setOpen(x)} className="glass-card rounded-2xl p-4 text-left space-y-2 hover:shadow-md">
            {x.photos[0] ? <Img id={x.photos[0].uploadId} alt={x.title} className="h-36 w-full rounded-xl object-cover" /> : <div className="h-36 rounded-xl bg-slate-100/70 flex items-center justify-center text-xs text-slate-400">No photos</div>}
            <div className="font-semibold">{x.title || "Untitled"}</div>
            <div className="text-xs text-slate-500">{x.presenter} · {fmt(x.presented_on)}</div>
          </button>
        ))}
      </div>
      {shown.length === 0 && <div className="text-sm text-slate-500">No spotlights match.</div>}
    </div>
  );
}

function FileForSomeone() {
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState("");
  const [loaded, setLoaded] = useState<{ key: string; spotlight: Spotlight | null } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    hubGet<{ people: { id: string; name: string }[] }>("/api/spotlights/for").then((d) => setPeople(d.people)).catch((e: Error) => setError(e.message));
  }, []);
  const open = () => hubGet<{ spotlight: Spotlight | null }>(`/api/spotlights/for?employeeId=${employeeId}&date=${date}`)
    .then((d) => setLoaded({ key: `${employeeId}|${date}`, spotlight: d.spotlight })).catch((e: Error) => setError(e.message));
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Super admin: file or fix a spotlight for any tech, on any date, even after the meeting.</p>
      <div className="flex gap-2 flex-wrap">
        <select className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setLoaded(null); }}>
          <option value="">Pick a tech</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="date" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={date} onChange={(e) => { setDate(e.target.value); setLoaded(null); }} />
        <button type="button" className="btn-brand" disabled={!employeeId || !date} onClick={() => void open()}>Open</button>
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
      {loaded && <SpotlightForm key={loaded.key} initial={loaded.spotlight} onBehalf={{ employeeId, date }} deadline={date} />}
    </div>
  );
}

export default function TechSpotlightPage() {
  const [mine, setMine] = useState<Mine | null>(null);
  const [tab, setTab] = useState<"mine" | "showcase" | "admin">("mine");
  const [error, setError] = useState("");
  useEffect(() => { hubGet<Mine>("/api/spotlights/mine").then(setMine).catch((e: Error) => setError(e.message)); }, []);
  const tabs: [typeof tab, string][] = [["mine", "My spotlight"], ["showcase", "Showcase"], ...(mine?.canFileForAnyone ? [["admin", "File for someone"] as [typeof tab, string]] : [])];
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Tech Spotlight</h1>
      <div className="flex gap-2 flex-wrap" role="tablist">
        {tabs.map(([k, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${tab === k ? "btn-brand" : "border-slate-200 bg-white/70"}`}>{n}</button>
        ))}
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}
      {tab === "mine" && (mine ? <MyTab mine={mine} /> : !error && <div className="text-sm text-slate-500">Loading…</div>)}
      {tab === "showcase" && <Showcase />}
      {tab === "admin" && mine?.canFileForAnyone && <FileForSomeone />}
    </div>
  );
}
