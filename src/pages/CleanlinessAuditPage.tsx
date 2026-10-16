// Cleanliness Audit: weekly vehicle / office check (Wednesday 9am → Tuesday night).
// Employees fill in and can edit their own audit until the week closes. Managers (their
// departments) and Cleanliness Admins open this page with ?for=<employee>&week=<Wednesday> to fix or
// fill one in. Photos upload one at a time as soon as they're chosen, with retries, so a weak
// signal never loses a whole audit. The server computes the score.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { hubGet, hubPut, hubUpload, shrinkImage, useMe, useUploadUrl } from "../lib/hubApi";

type Item = { key: string; label: string };
type Section = { title: string; checklist: readonly Item[]; photos: readonly Item[] };
type SectionKey = "vehicle" | "office";
type Audit = {
  week_start: string; score: number; vehicle_score: number | null; office_score: number | null;
  answers: Partial<Record<SectionKey, Record<string, boolean>>>; photos: Record<string, string>;
  submitted_at: string; edit_count: number; last_edited_at: string | null;
};
type Form = {
  week: string; currentWeek: string; locked: boolean; onPto: boolean;
  editingFor: { id: string; name: string } | null;
  sections: Record<SectionKey, boolean>; noun: string; vehicleNumber: string;
  questions: Record<SectionKey, Section>; audit: Audit | null;
};
type PhotoState = { id?: string; preview?: string; status: "idle" | "uploading" | "done" | "error"; error?: string };

const ORDER: SectionKey[] = ["vehicle", "office"];
const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
const weekLabel = (wed: string) => {
  const end = new Date(`${wed}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${fmtDate(wed)} – ${fmtDate(end.toISOString().slice(0, 10))}`;
};

function StoredPhoto({ id, label }: { id: string; label: string }) {
  const url = useUploadUrl(id);
  return url ? <img src={url} alt={label} className="h-28 w-full rounded-xl object-cover" /> : <div className="h-28 rounded-xl bg-slate-200/60" />;
}

function PhotoSlot({ label, state, onPick }: { label: string; state: PhotoState; onPick: (f: File) => void }) {
  const stored = useUploadUrl(state.preview ? null : state.id);
  const src = state.preview ?? stored;
  return (
    <label className="block cursor-pointer rounded-xl border border-dashed border-slate-300 p-2 text-center text-xs">
      {src ? <img src={src} alt={label} className="mb-1 h-28 w-full rounded-lg object-cover" />
        : <div className="mb-1 flex h-28 items-center justify-center rounded-lg bg-slate-100/70 text-slate-500">Tap to add photo</div>}
      <div className="font-semibold">{label}</div>
      <div className={state.status === "error" ? "text-red-700" : "text-slate-500"}>
        {state.status === "uploading" ? "Uploading…" : state.status === "done" ? "✓ Saved" : state.status === "error" ? `${state.error} Tap to retry.` : "Optional: counts toward your score"}
      </div>
      <input type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
    </label>
  );
}

function Summary({ form, audit }: { form: Form; audit: Audit }) {
  const noun = (s: string) => s.replace(/\{Noun\}/g, form.noun[0].toUpperCase() + form.noun.slice(1));
  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="text-4xl font-black">{audit.score}%</div>
        <div className="text-xs text-slate-500">cleanliness score{audit.edit_count ? ` · edited ${audit.edit_count}×` : ""}</div>
      </div>
      {ORDER.filter((s) => audit.answers[s]).map((s) => (
        <div key={s} className="rounded-xl border border-slate-200 p-4 space-y-2">
          <div className="flex justify-between font-semibold">
            <span>{noun(form.questions[s].title)}</span>
            <span>{s === "vehicle" ? audit.vehicle_score : audit.office_score}%</span>
          </div>
          {form.questions[s].checklist.map((q) => (
            <div key={q.key} className="flex justify-between text-sm">
              <span>{noun(q.label)}</span><span>{audit.answers[s]?.[q.key] ? "✓ Yes" : "✗ No"}</span>
            </div>
          ))}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
            {form.questions[s].photos.filter((p) => audit.photos[`${s}.${p.key}`]).map((p) => (
              <StoredPhoto key={p.key} id={audit.photos[`${s}.${p.key}`]} label={noun(p.label)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CleanlinessAuditPage() {
  const [params] = useSearchParams();
  const { me } = useMe();
  const forId = params.get("for") ?? "";
  const weekParam = params.get("week") ?? "";
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState(false);
  const [answers, setAnswers] = useState<Partial<Record<SectionKey, Record<string, boolean>>>>({});
  const [photos, setPhotos] = useState<Record<string, PhotoState>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = () => {
    const qs = new URLSearchParams({ ...(forId ? { for: forId } : {}), ...(weekParam ? { week: weekParam } : {}) });
    hubGet<Form>(`/api/cleanliness/form?${qs}`).then((f) => {
      setForm(f);
      setAnswers(f.audit?.answers ?? {});
      setPhotos(Object.fromEntries(Object.entries(f.audit?.photos ?? {}).map(([k, id]) => [k, { id, status: "done" as const }])));
      setEditing(!f.audit);
    }).catch((e: Error) => setError(e.message));
  };
  useEffect(load, [forId, weekParam]);

  const pick = async (slot: string, file: File) => {
    const preview = URL.createObjectURL(file);
    setPhotos((p) => ({ ...p, [slot]: { preview, status: "uploading" } }));
    try {
      const blob = await shrinkImage(file).catch(() => file);
      const id = await hubUpload(blob, "cleanliness");
      setPhotos((p) => ({ ...p, [slot]: { id, preview, status: "done" } }));
    } catch (e) {
      setPhotos((p) => ({ ...p, [slot]: { preview, status: "error", error: (e as Error).message } }));
    }
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError("");
    try {
      const saved = await hubPut<Audit & { was_edit: boolean }>("/api/cleanliness/audit", {
        employeeId: form.editingFor?.id, week: form.editingFor ? form.week : undefined, answers,
        photos: Object.fromEntries(Object.entries(photos).filter(([, s]) => s.id).map(([k, s]) => [k, s.id])),
      });
      setMessage(saved.was_edit ? `Audit updated (${saved.score}%).` : `Audit saved (${saved.score}%). See you next week!`);
      setForm({ ...form, audit: saved });
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error && !form) return <div className="glass-card rounded-2xl p-6 text-sm text-red-700">{error}</div>;
  if (!form) return <div className="text-sm text-slate-500">Loading…</div>;

  const noun = (s: string) => s.replace(/\{Noun\}/g, form.noun[0].toUpperCase() + form.noun.slice(1));
  const active = ORDER.filter((s) => form.sections[s]);
  const uploading = Object.values(photos).some((p) => p.status === "uploading");
  const canEditNow = !!form.editingFor || (form.week === form.currentWeek && !form.locked);
  const canViewReport = !!me?.permissions["cleanliness.view_report"];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Cleanliness Audit</h1>
          <p className="text-sm text-slate-500">Week of {weekLabel(form.week)}{form.editingFor ? ` · for ${form.editingFor.name}` : ""}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canViewReport && <Link to="/cleanliness/report" className="rounded-xl border border-slate-300 px-4 py-2 text-sm">Cleanliness Report</Link>}
          <button type="button" className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-400" disabled
            title="Coming soon: waiting on the common-area criteria">Common Area Audit</button>
        </div>
      </div>

      {form.editingFor && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-slate-800">
          You're {form.audit ? "editing" : "filling in"} {form.editingFor.name}'s audit. This is recorded as your change.
        </div>
      )}
      {form.onPto && !form.audit && <div className="rounded-xl border border-slate-200 p-3 text-sm">Marked as PTO for this week. No audit needed.</div>}
      {form.locked && <div className="glass-card rounded-2xl p-6 text-sm">Reporting is locked until 9am Wednesday for the weekly meeting.</div>}
      {active.length === 0 && <div className="glass-card rounded-2xl p-6 text-sm">There's no vehicle or office on file to audit. Ask your manager to update your profile.</div>}
      {message && <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-slate-800">{message}</div>}

      {!form.locked && active.length > 0 && !editing && form.audit && (
        <div className="glass-card rounded-2xl p-6 space-y-4">
          <Summary form={form} audit={form.audit} />
          {canEditNow && (
            <button type="button" className="btn-brand" onClick={() => { setEditing(true); setMessage(""); }}>Edit this audit</button>
          )}
        </div>
      )}

      {!form.locked && active.length > 0 && editing && canEditNow && (
        <div className="glass-card rounded-2xl p-6 space-y-6">
          {active.map((s) => {
            const cfg = form.questions[s];
            return (
              <div key={s} className="space-y-3">
                <h2 className="text-lg font-semibold">
                  {noun(cfg.title)}{s === "vehicle" && form.vehicleNumber ? ` #${form.vehicleNumber}` : ""}
                </h2>
                {cfg.checklist.map((q) => {
                  const v = answers[s]?.[q.key];
                  const set = (val: boolean) => setAnswers((a) => ({ ...a, [s]: { ...(a[s] ?? {}), [q.key]: val } }));
                  return (
                    <div key={q.key} className="flex items-center justify-between gap-3 text-sm">
                      <span>{noun(q.label)}</span>
                      <div className="flex gap-2" role="group" aria-label={noun(q.label)}>
                        <button type="button" aria-pressed={v === true} onClick={() => set(true)}
                          className={`rounded-xl border px-4 py-1 ${v === true ? "btn-brand" : "border-slate-200 bg-white/70"}`}>Yes</button>
                        <button type="button" aria-pressed={v === false} onClick={() => set(false)}
                          className={`rounded-xl border px-4 py-1 ${v === false ? "btn-brand" : "border-slate-200 bg-white/70"}`}>No</button>
                      </div>
                    </div>
                  );
                })}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {cfg.photos.map((p) => {
                    const slot = `${s}.${p.key}`;
                    return <PhotoSlot key={slot} label={noun(p.label)} state={photos[slot] ?? { status: "idle" }} onPick={(f) => void pick(slot, f)} />;
                  })}
                </div>
              </div>
            );
          })}
          {error && <div className="text-sm text-red-700">{error}</div>}
          <div className="flex gap-2">
            <button type="button" className="btn-brand" disabled={saving || uploading} onClick={save}>
              {uploading ? "Waiting for photos…" : saving ? "Saving…" : form.audit ? "Save changes" : "Submit audit"}
            </button>
            {form.audit && <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm" onClick={load}>Cancel</button>}
          </div>
          <p className="text-xs text-slate-500">Unanswered questions count as No. You can edit this audit until Tuesday night.</p>
        </div>
      )}
    </div>
  );
}
