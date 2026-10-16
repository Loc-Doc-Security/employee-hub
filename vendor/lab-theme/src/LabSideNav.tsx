import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";

export type LabNavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  show?: boolean;
  badge?: number | string;
  /** Match child paths (default: true except for exact `/`) */
  matchPrefix?: boolean;
};

export type LabNavSection = {
  id: string;
  label: string;
  defaultOpen?: boolean;
  items: LabNavItem[];
};

export type LabSideNavProps = {
  quickLinks?: LabNavItem[];
  sections: LabNavSection[];
  header?: React.ReactNode;
  footer?: React.ReactNode;
  onNavigate?: () => void;
  className?: string;
};

function cn(...parts: (string | false | undefined | null)[]) {
  return parts.filter(Boolean).join(" ");
}

function isActive(pathname: string, item: LabNavItem) {
  if (item.to === "/") return pathname === "/";
  const prefix = item.matchPrefix !== false;
  return pathname === item.to || (prefix && pathname.startsWith(`${item.to}/`));
}

function NavRow({
  item,
  pathname,
  onNavigate,
  variant,
}: {
  item: LabNavItem;
  pathname: string;
  onNavigate?: () => void;
  variant: "quick" | "group";
}) {
  const active = isActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      className={cn(
        "lab-nav-link",
        variant === "quick" ? "lab-nav-link--quick" : "lab-nav-link--group",
        active && "lab-nav-link--active",
      )}
    >
      <Icon className="lab-nav-link__icon w-5 h-5 shrink-0" aria-hidden />
      <span className="lab-nav-link__label min-w-0 truncate">{item.label}</span>
      {item.badge != null && Number(item.badge) > 0 ? (
        <span className="lab-nav-link__badge ml-auto">{item.badge}</span>
      ) : null}
      {variant === "group" ? (
        <ChevronRight className="lab-nav-link__chevron w-4 h-4 ml-auto opacity-0" aria-hidden />
      ) : null}
    </Link>
  );
}

export function LabSideNav({
  quickLinks = [],
  sections,
  header,
  footer,
  onNavigate,
  className,
}: LabSideNavProps) {
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sections.map((s) => [s.id, s.defaultOpen ?? true])),
  );

  useEffect(() => {
    for (const section of sections) {
      if (section.items.some((item) => item.show !== false && isActive(location.pathname, item))) {
        setOpenGroups((prev) => ({ ...prev, [section.id]: true }));
      }
    }
  }, [location.pathname, sections]);

  const visibleQuick = quickLinks.filter((l) => l.show !== false);
  const visibleSections = sections
    .map((s) => ({ ...s, items: s.items.filter((i) => i.show !== false) }))
    .filter((s) => s.items.length > 0);

  return (
    <div className={cn("lab-sidebar flex flex-col h-full", className)}>
      {header ? <div className="lab-sidebar__header shrink-0">{header}</div> : null}

      {visibleQuick.length > 0 ? (
        <div className="lab-sidebar__quick shrink-0">
          {visibleQuick.map((item) => (
            <NavRow
              key={item.to}
              item={item}
              pathname={location.pathname}
              onNavigate={onNavigate}
              variant="quick"
            />
          ))}
        </div>
      ) : null}

      {visibleQuick.length > 0 && visibleSections.length > 0 ? (
        <div className="lab-sidebar__divider" role="separator" />
      ) : null}

      <div className="lab-sidebar__groups flex-1 overflow-y-auto custom-scrollbar min-h-0">
        {visibleSections.map((section) => {
          const isOpen = openGroups[section.id] ?? true;
          return (
            <div key={section.id} className="lab-sidebar__section">
              <button
                type="button"
                onClick={() => setOpenGroups((p) => ({ ...p, [section.id]: !p[section.id] }))}
                className="lab-sidebar__section-toggle"
              >
                <span>{section.label}</span>
                {isOpen ? (
                  <ChevronDown className="w-4 h-4 shrink-0 opacity-60" />
                ) : (
                  <ChevronRight className="w-4 h-4 shrink-0 opacity-60" />
                )}
              </button>
              {isOpen ? (
                <div>
                  {section.items.map((item) => (
                    <NavRow
                      key={item.to}
                      item={item}
                      pathname={location.pathname}
                      onNavigate={onNavigate}
                      variant="group"
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {footer ? <div className="lab-sidebar__footer shrink-0">{footer}</div> : null}
    </div>
  );
}
