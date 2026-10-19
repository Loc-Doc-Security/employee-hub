// Local-dev only: act as any employee to see exactly what their role allows. The server ignores
// the choice outside local dev (LAB_DEV_SIMPLE_AUTH=1, non-production), and /api/me only sends the
// option list when it's enabled, so this renders nothing in production.
import { getViewAs, setViewAs, useMe } from "../lib/hubApi";

export default function ViewAsPicker() {
  const { me } = useMe();
  if (!me?.viewAs) return null;
  const current = getViewAs();
  return (
    <div className="px-2 pb-3 space-y-1">
      <div className="text-xs font-semibold text-amber-600">
        Dev · viewing as {me.employee ? `${me.employee.first_name} ${me.employee.last_name}` : "—"}
      </div>
      <select
        className="w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-slate-200"
        value={current}
        onChange={(e) => setViewAs(e.target.value)}
      >
        <option value="">Default (super admin)</option>
        {me.viewAs.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}{o.roles ? ` — ${o.roles}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
