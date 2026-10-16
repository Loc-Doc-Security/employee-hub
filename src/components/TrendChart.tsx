// One measure over time on a fixed scale (1–5 by default; min/max/ticks for others, e.g. 0–100). Used as small multiples (one chart per measure)
// rather than three lines on one chart, because "higher" means different things per measure
// (high morale = good, high stress = bad); each chart's title names its own direction.
import { useMemo, useRef, useState } from "react";

export type TrendPoint = { week: string; value: number };

const W = 640, H = 160, PAD = { l: 28, r: 12, t: 12, b: 24 };

const fmtWeek = (w: string) =>
  new Date(`${w}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });

export default function TrendChart({ title, hint, points, min = 1, max = 5, ticks, formatLabel = fmtWeek }: {
  title: string; hint: string; points: TrendPoint[]; min?: number; max?: number; ticks?: number[];
  formatLabel?: (week: string) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const sorted = useMemo(() => [...points].sort((a, b) => a.week.localeCompare(b.week)), [points]);

  const x = (i: number) => PAD.l + (sorted.length <= 1 ? (W - PAD.l - PAD.r) / 2 : (i / (sorted.length - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + ((max - v) / (max - min)) * (H - PAD.t - PAD.b);
  const gridValues = ticks ?? Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const path = sorted.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const avg = sorted.length ? sorted.reduce((s, p) => s + p.value, 0) / sorted.length : 0;

  const onMove = (e: React.PointerEvent) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || !sorted.length) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    sorted.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    setHover(best);
  };

  const h = hover !== null ? sorted[hover] : null;
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-slate-500">{hint}</div>
        </div>
        <div className="text-xs text-slate-500 text-right">
          {h ? <>{formatLabel(h.week)}: <span className="font-semibold text-slate-800">{h.value}</span></>
             : sorted.length ? <>avg <span className="font-semibold text-slate-800">{avg.toFixed(1)}</span></> : null}
        </div>
      </div>
      {sorted.length === 0 ? (
        <div className="text-sm text-slate-500 py-8 text-center">No reports in this range.</div>
      ) : (
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-2 touch-none"
             role="img" aria-label={`${title} over time, ${sorted.length} points, average ${avg.toFixed(1)}`}
             onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {gridValues.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-slate-300" strokeOpacity={v === gridValues[Math.floor(gridValues.length / 2)] ? 0.9 : 0.45} strokeWidth={1} />
              <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} className="fill-slate-500">{v}</text>
            </g>
          ))}
          <text x={PAD.l} y={H - 6} fontSize={11} className="fill-slate-500">{formatLabel(sorted[0].week)}</text>
          <text x={W - PAD.r} y={H - 6} fontSize={11} textAnchor="end" className="fill-slate-500">{formatLabel(sorted[sorted.length - 1].week)}</text>
          <path d={path} fill="none" stroke="var(--theme-accent-600, #2563eb)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {sorted.length === 1 && <circle cx={x(0)} cy={y(sorted[0].value)} r={4} fill="var(--theme-accent-600, #2563eb)" />}
          {h && hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="currentColor" className="text-slate-400" strokeWidth={1} />
              <circle cx={x(hover)} cy={y(h.value)} r={5} fill="var(--theme-accent-600, #2563eb)" stroke="var(--theme-surface, #fff)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
