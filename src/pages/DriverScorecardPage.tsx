// Driver Scorecard (managers and Scorecard Uploaders): upload the weekly Geotab "Expanded" PDF and
// review any week. Uploading a week that already exists replaces it.
import { useEffect, useState } from "react";
import { getAuthToken } from "../lib/authToken";
import { getViewAs, hubGet } from "../lib/hubApi";

type Week = { week_start: string; week_label: string; fleet_score: number | null; uploaded_by: string | null };
type Row = {
  id: string; vehicle_label: string; name: string | null; classification: string; score: number | null;
  hard_acceleration: number | null; harsh_braking: number | null; harsh_cornering: number | null;
  seatbelt: number | null; speeding: number | null; distracted: number | null;
  is_parked: boolean; parked_reason: string | null;
};
type WeekData = { week_start: string; week_label: string; fleet_score: number | null; rows: Row[]; ruleAverages: Record<string, number | null> };
type UploadResult = { weekLabel: string; fleetScore: number | null; drivers: number; counts: Record<string, number> };

export const RULES = [
  ["hard_acceleration", "Hard accel."], ["harsh_braking", "Harsh braking"], ["harsh_cornering", "Harsh cornering"],
  ["seatbelt", "Seatbelt"], ["speeding", "Speeding"], ["distracted", "Distracted"],
] as const;
export const PARKED: Record<string, string> = {
  no_activity: "No activity", no_employee_match: "Van not assigned", inactive: "Inactive employee", pto: "PTO",
};

async function uploadPdf(file: File): Promise<UploadResult> {
  const headers = new Headers({ "Content-Type": "application/pdf" });
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const viewAs = getViewAs();
  if (viewAs) headers.set("x-view-as", viewAs);
  const res = await fetch("/api/driver-scorecard/upload", { method: "POST", headers, body: file });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? `Upload failed (HTTP ${res.status})`);
  return json.data;
}

export function DriverTable({ data }: { data: WeekData }) {
  const ranked = data.rows.filter((r) => !r.is_parked);
  const parked = data.rows.filter((r) => r.is_parked);
  return (
    <div className="space-y-3">
      <div className="glass-card rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr><th className="p-3">#</th><th className="p-3">Driver</th><th className="p-3">Score</th>{RULES.map(([, l]) => <th key={l} className="p-3">{l}</th>)}</tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => (
              <tr key={r.id} className="border-t border-slate-800">
                <td className="p-3 text-slate-500">{i + 1}</td>
                <td className="p-3"><div className="font-semibold">{r.name || "—"}</div><div className="text-xs text-slate-500">Van {r.vehicle_label} · {r.classification}</div></td>
                <td className="p-3 font-semibold">{r.score}</td>
                {RULES.map(([k]) => <td key={k} className="p-3">{r[k]}</td>)}
              </tr>
            ))}
            <tr className="border-t-2 border-slate-700 text-slate-400">
              <td className="p-3" /><td className="p-3 font-semibold">Fleet average</td>
              <td className="p-3 font-semibold">{data.fleet_score?.toFixed(1) ?? "—"}</td>
              {RULES.map(([k]) => <td key={k} className="p-3">{data.ruleAverages[k] ?? "—"}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      {parked.length > 0 && (
        <div className="glass-card rounded-2xl p-4 text-sm space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Parked (not ranked)</div>
          {parked.map((r) => (
            <div key={r.id} className="flex justify-between gap-3">
              <span>{r.name || "—"} <span className="text-slate-500">· Van {r.vehicle_label}</span></span>
              <span className="text-slate-500">{PARKED[r.parked_reason ?? ""] ?? r.parked_reason}{r.score != null ? ` · ${r.score}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DriverScorecardPage() {
  const [weeks, setWeeks] = useState<Week[] | null>(null);
  const [week, setWeek] = useState("");
  const [data, setData] = useState<WeekData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState("");

  const loadWeeks = () => hubGet<Week[]>("/api/driver-scorecard/weeks").then((w) => { setWeeks(w); return w; }).catch((e: Error) => { setError(e.message); return []; });
  useEffect(() => { void loadWeeks().then((w) => w[0] && setWeek(w[0].week_start)); }, []);
  useEffect(() => {
    if (!week) return;
    setData(null);
    hubGet<WeekData>(`/api/driver-scorecard/week?week=${week}`).then(setData).catch((e: Error) => setError(e.message));
  }, [week]);

  const upload = async (file: File) => {
    setUploading(true);
    setError("");
    setResult(null);
    try {
      const r = await uploadPdf(file);
      setResult(r);
      const w = await loadWeeks();
      const match = w.find((x) => x.week_label === r.weekLabel);
      if (match) { setWeek(""); setTimeout(() => setWeek(match.week_start), 0); }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">Driver Scorecard</h1>
      <div className="glass-card rounded-2xl p-6 space-y-3">
        <div className="font-semibold">Upload this week's Geotab scorecard</div>
        <div className="text-sm text-slate-500">The "Driver Safety Scorecard (Expanded)" PDF. Uploading a week that's already here replaces it.</div>
        <label className={`inline-block rounded-xl px-4 py-2 text-sm ${uploading ? "border border-slate-700 text-slate-600" : "btn-brand cursor-pointer"}`}>
          {uploading ? "Reading the PDF…" : "Choose PDF"}
          <input type="file" accept="application/pdf" className="hidden" disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        </label>
        {result && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-slate-200">
            ✓ {result.weekLabel}: {result.drivers} drivers, fleet score {result.fleetScore?.toFixed(1) ?? "—"}. Ranked {result.counts.ranked}
            {Object.entries(result.counts).filter(([k, v]) => k !== "ranked" && v > 0).map(([k, v]) => `, ${PARKED[k]} ${v}`).join("")}.
          </div>
        )}
        {error && <div className="text-sm text-red-700">{error}</div>}
      </div>

      {weeks && weeks.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Week</span>
          <select className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2" value={week} onChange={(e) => setWeek(e.target.value)}>
            {weeks.map((w) => <option key={w.week_start} value={w.week_start}>{w.week_label}{w.uploaded_by ? ` · ${w.uploaded_by}` : ""}</option>)}
          </select>
        </div>
      )}
      {data ? <DriverTable data={data} /> : week && !error && <div className="text-sm text-slate-500">Loading…</div>}
    </div>
  );
}
