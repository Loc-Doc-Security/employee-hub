// A page's title with its icon chip (the same icon as its Home tile and menu item, looked up from
// src/lib/nav.ts by the current address), and an optional line or controls underneath.
import type { ComponentType, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { NAV_GROUPS } from "../lib/nav";

const ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export default function PageTitle({ title, icon, children }: { title: ReactNode; icon?: ComponentType<{ className?: string }>; children?: ReactNode }) {
  const { pathname } = useLocation();
  const Icon = icon ?? ITEMS.find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))?.icon;
  return (
    <div className="hub-page-header">
      {Icon && <span className="hub-icon-chip"><Icon /></span>}
      <div className="min-w-0">
        <h1>{title}</h1>
        {children && <div className="text-sm text-slate-500 mt-0.5">{children}</div>}
      </div>
    </div>
  );
}
