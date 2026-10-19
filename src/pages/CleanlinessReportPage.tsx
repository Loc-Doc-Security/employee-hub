// Cleanliness Report: any manager sees the whole company; Mark PTO and Fix appear only where the
// server allows them (their departments, or anyone for Cleanliness Admins). PTO is a one-button
// manager decision for the work week, recorded with who marked it.
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { hubDelete, hubGet, hubPost, useUploadUrl } from "../lib/hubApi";
import TrendChart from "../components/TrendChart";
import PageTitle from "../components/PageTitle";

type Person = {
  id: string; name: string; branch: string | null; departments: string; vehicle_number: string | null; has_office: boolean;
  status: "submitted" | "pto" | "missing"; score: number | null; vehicle_score: number | null; office_score: number | null;
  submitted_at: string | null; edit_count: number | null; answers: Record<string, Record<string, boolean>> | null;
  photos: Record<string, string> | null; pto_marked_by: string | null; pto_marked_at: string | null;
  canMarkPto: boolean; canFix: boolean;
};
type Report = { week: string; currentWeek: string; people: Person[]; trend: { week: string; avg_score: number; submitted: number }[] };

const shift = (w: string, weeks: number) => {
  const d = new Date(`${w}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
};
const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const STATUS = { submitted: "✓ Submitted", pto: "PTO", missing: "Missing" } as const;

function Photo({ id }: { id: string }) {
  const url = useUploadUrl(id);
  return url ? <img src={url} alt="Audit photo" className="h-24 w-full rounded-lg object-cover" /> : <div className="h-24 rounded-lg bg-slate-700/60" />;
}

export default function CleanlinessReportPage() {
  const [week, setWeek] = useState<string | null>(null);
  const [data, setData] = useState<Report | null>(null);
  const [filter, setFilter] = useState<"all" | Person["status"]>("all");
  const [branch, setBranch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = (w: string | null) =>
    hubGet<Report>(`/api/cleanliness/report${w ? `?week=${w}` : ""}`)
      .then((d) => { setData(d); setWeek(d.week); setError(""); })
      .catch((e: Error) => setError(e.message));
  useEffect(() => { void load(null); }, []);

  const pto = async (p: Person, mark: boolean) => {
    if (!data) return;
    setBusy(p.id);
    try {
      const body = { employeeId: p.id, week: data.week };
      if (mark) await hubPost("/api/pto", body); else await hubDelete("/api/pto", body);
      await load(data.week);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const branches = useMemo(() => [...new Set((data?.people ?? []).map((p) => p.branch ?? "—"))].sort(), [data]);
  if (error && !data) return <div className="glass-card rounded-2xl p-6 text-sm text-red-700">{error}</div>;
  if (!data || !week) return <div className="text-sm text-slate-500">Loading…</div>;

  const inBranch = data.people.filter((p) => !branch || (p.branch ?? "—") === branch);
  const shown = inBranch.filter((p) => filter === "all" || p.status === filter);
  const count = (s: Person["status"]) => inBranch.filter((p) => p.status === s).length;
  const scored = inBranch.filter((p) => p.score !== null);
  const avg = scored.length ? Math.round(scored.reduce((s, p) => s + (p.score ?? 0), 0) / scored.length) : null;
  const trend = data.trend.map((t) => ({ week: t.week, value: t.avg_score }));

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <PageTitle title="Cleanliness Report">
          <div className="flex items-center gap-2 text-sm mt-1">
            <button type="button" className="rounded-xl border border-slate-700 px-3 py-1" onClick={() => void load(shift(week, -1))}>← Prev</button>
            <span className="font-semibold">Week of {fmt(week)}</span>
            <button type="button" className="rounded-xl border border-slate-700 px-3 py-1" disabled={week >= data.currentWeek}
              onClick={() => void load(shift(week, 1))}>Next →</button>
          </div>
        </PageTitle>
        <Link to="/cleanliness" className="rounded-xl border border-slate-600 px-4 py-2 text-sm">My audit</Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[["Submitted", count("submitted")], ["Missing", count("missing")], ["PTO", count("pto")], ["Average score", avg === null ? "—" : `${avg}%`]].map(([label, value]) => (
          <div key={label} className="glass-card rounded-2xl p-4">
            <div className="text-xs text-slate-500">{label}</div>
            <div className="text-2xl font-bold">{value}</div>
          </div>
        ))}
      </div>

      {trend.length > 1 && (
        <TrendChart title="Average score by week" hint="Everyone who submitted, 0–100%" points={trend}
          min={0} max={100} ticks={[0, 25, 50, 75, 100]} />
      )}

      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="flex gap-2 flex-wrap">
        {(["all", "missing", "submitted", "pto"] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={`rounded-xl border px-3 py-1 text-sm ${filter === f ? "btn-brand" : "border-slate-700 bg-slate-900/70"}`}>
            {f === "all" ? "Everyone" : STATUS[f]}
          </button>
        ))}
        <select className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-1 text-sm" value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value="">All branches</option>
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      <div className="glass-card rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr><th className="p-3">Name</th><th className="p-3">Branch</th><th className="p-3">Status</th><th className="p-3">Score</th><th className="p-3"></th></tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <Fragment key={p.id}>
                <tr className="border-t border-slate-800">
                  <td className="p-3"><div className="font-semibold">{p.name}</div><div className="text-xs text-slate-500">{p.departments || "—"}</div></td>
                  <td className="p-3">{p.branch ?? "—"}</td>
                  <td className="p-3">
                    {STATUS[p.status]}
                    {p.status === "pto" && p.pto_marked_by && <div className="text-xs text-slate-500">by {p.pto_marked_by}</div>}
                  </td>
                  <td className="p-3 font-semibold">{p.score === null ? "—" : `${p.score}%`}</td>
                  <td className="p-3 text-right whitespace-nowrap space-x-2">
                    {p.status === "submitted" && (
                      <button type="button" className="btn-text" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? "Hide" : "View"}</button>
                    )}
                    {p.canFix && (
                      <Link className="btn-text" to={`/cleanliness?for=${p.id}&week=${week}`}>{p.status === "submitted" ? "Fix" : "Submit for"}</Link>
                    )}
                    {p.canMarkPto && p.status === "missing" && (
                      <button type="button" className="btn-text" disabled={busy === p.id} onClick={() => void pto(p, true)}>Mark PTO</button>
                    )}
                    {p.canMarkPto && p.status === "pto" && (
                      <button type="button" className="btn-text" disabled={busy === p.id} onClick={() => void pto(p, false)}>Remove PTO</button>
                    )}
                  </td>
                </tr>
                {open === p.id && p.answers && (
                  <tr className="border-t border-slate-800">
                    <td colSpan={5} className="p-4 space-y-3">
                      <div className="text-sm text-slate-400">
                        {p.vehicle_score !== null && <>Vehicle {p.vehicle_score}% · </>}
                        {p.office_score !== null && <>Office {p.office_score}% · </>}
                        {p.edit_count ? `edited ${p.edit_count}×` : "not edited"}
                      </div>
                      {Object.entries(p.answers).map(([section, qs]) => (
                        <div key={section} className="text-sm">
                          <span className="font-semibold capitalize">{section}:</span>{" "}
                          {Object.entries(qs).map(([k, v]) => `${k} ${v ? "✓" : "✗"}`).join(" · ")}
                        </div>
                      ))}
                      {p.photos && Object.keys(p.photos).length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {Object.entries(p.photos).map(([slot, id]) => <Photo key={slot} id={id} />)}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
