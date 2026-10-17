// Credit Card receipts (28-day rolling, synced weekly from accounting's sheet).
// Everyone: company and team totals. You: your own numbers and your team's total. Managers: the
// people on their teams, lowest first. Team totals are weighted (receipts ÷ purchases).
import { useEffect, useState } from "react";
import { hubGet } from "../lib/hubApi";
import TrendChart from "../components/TrendChart";

type Dept = { department: string; purchases: number; receipts: number; people: number; percent: number | null };
type Report = {
  week: string; weeks: string[];
  company: { purchases: number; receipts: number; percent: number | null };
  departments: Dept[];
  mine: { purchases: number; receipts: number; percent: number | null; department: string; departmentPercent: number | null } | null;
  team: { name: string; department: string; purchases: number; receipts: number; percent: number | null }[] | null;
  trend: { week: string; percent: number | null }[];
};

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const show = (p: number | null) => (p == null ? "—" : `${p}%`);

export function DepartmentBars({ departments }: { departments: Dept[] }) {
  return (
    <div className="space-y-2">
      {departments.map((d) => (
        <div key={d.department} className="grid grid-cols-[10rem_1fr_4rem] items-center gap-3 text-sm">
          <span className="truncate">{d.department}</span>
          <div className="h-2 rounded-full bg-slate-200/70 overflow-hidden">
            {d.percent != null && <div className="h-full rounded-full" style={{ width: `${d.percent}%`, background: "var(--theme-accent-600, #2563eb)" }} />}
          </div>
          <span className="text-right font-semibold">{show(d.percent)}</span>
        </div>
      ))}
    </div>
  );
}

export default function CreditCardPage() {
  const [week, setWeek] = useState("");
  const [data, setData] = useState<Report | null | undefined>(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    hubGet<Report | null>(`/api/credit-card/report${week ? `?week=${week}` : ""}`).then(setData).catch((e: Error) => setError(e.message));
  }, [week]);

  if (error) return <div className="glass-card rounded-2xl p-6 text-sm text-red-700">{error}</div>;
  if (data === undefined) return <div className="text-sm text-slate-500">Loading…</div>;
  if (data === null) return <div className="glass-card rounded-2xl p-6 text-sm">No receipt data has been synced yet.</div>;
  const trend = data.trend.filter((t) => t.percent != null).map((t) => ({ week: t.week, value: t.percent as number }));

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Credit Card Receipts</h1>
          <p className="text-sm text-slate-500">Receipts uploaded vs. card purchases over the last 28 days, as of the week of {fmt(data.week)}.</p>
        </div>
        {data.weeks.length > 1 && (
          <select className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm" value={data.week} onChange={(e) => setWeek(e.target.value)}>
            {data.weeks.map((w) => <option key={w} value={w}>Week of {fmt(w)}</option>)}
          </select>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card rounded-2xl p-6">
          <div className="text-xs text-slate-500">Company</div>
          <div className="text-4xl font-black">{show(data.company.percent)}</div>
          <div className="text-sm text-slate-500">{data.company.receipts} of {data.company.purchases} receipts uploaded</div>
        </div>
        {data.mine && (
          <div className="glass-card rounded-2xl p-6">
            <div className="text-xs text-slate-500">You</div>
            <div className="text-4xl font-black">{show(data.mine.percent)}</div>
            <div className="text-sm text-slate-500">
              {data.mine.receipts} of {data.mine.purchases} receipts uploaded · {data.mine.department}: {show(data.mine.departmentPercent)}
            </div>
          </div>
        )}
      </div>

      <div className="glass-card rounded-2xl p-6 space-y-3">
        <div className="font-semibold">By team</div>
        <DepartmentBars departments={data.departments} />
      </div>

      {trend.length > 1 && <TrendChart title="Company receipt rate" hint="Weekly, 0–100%" points={trend} min={0} max={100} ticks={[0, 25, 50, 75, 100]} />}

      {data.team && data.team.length > 0 && (
        <div className="glass-card rounded-2xl overflow-x-auto">
          <div className="p-3 text-xs text-slate-500">Your team · lowest first</div>
          <table className="w-full text-sm">
            <tbody>
              {data.team.map((t) => (
                <tr key={t.name} className="border-t border-slate-100">
                  <td className="p-3"><div className="font-semibold">{t.name}</div><div className="text-xs text-slate-500">{t.department}</div></td>
                  <td className="p-3">{t.receipts} of {t.purchases}</td>
                  <td className="p-3 font-semibold">{show(t.percent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
