"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Building2,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  LayoutDashboard,
  Menu,
  Radio,
  SearchCheck,
  Upload,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Other paths that light this item up. */
  also?: RegExp;
}

const GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, also: /^\/board/ },
      { href: "/leads", label: "Leads", icon: Users },
      { href: "/visits", label: "Site Visits", icon: CalendarDays },
      { href: "/projects", label: "Projects", icon: Building2 },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/match", label: "Match Finder", icon: SearchCheck },
      { href: "/import", label: "Import", icon: Upload },
    ],
  },
  { label: "Insights", items: [{ href: "/channels", label: "Channels", icon: Radio }] },
  { label: "Settings", items: [{ href: "/templates", label: "Templates", icon: FileText }] },
];

function isActive(path: string, item: NavItem) {
  if (item.also?.test(path)) return true;
  return item.href === "/" ? path === "/" : path === item.href || path.startsWith(`${item.href}/`);
}

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {GROUPS.map((g, i) => (
        <div key={g.label ?? i} className="flex flex-col gap-0.5">
          {g.label &&
            (collapsed ? (
              <div className="mx-3 my-3 h-px bg-white/10" />
            ) : (
              <div className="px-3 pt-5 pb-1.5 text-[10.5px] font-semibold tracking-[0.1em] text-navy-fg/55 uppercase">{g.label}</div>
            ))}
          {g.items.map((item) => {
            const active = isActive(path, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition ${
                  active ? "bg-navy-2 text-white" : "text-navy-fg hover:bg-white/5 hover:text-white"
                } ${collapsed ? "justify-center px-0" : ""}`}
              >
                {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-accent" />}
                <Icon className="size-[18px] flex-none" strokeWidth={1.75} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/" className={`flex items-center gap-2.5 px-2 ${collapsed ? "justify-center px-0" : ""}`}>
      <span className="grid size-8 flex-none place-items-center rounded-lg bg-accent text-sm font-bold text-white">R</span>
      {!collapsed && (
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold tracking-tight text-white">RealtyNiti</span>
          <span className="block text-[11px] font-medium text-navy-fg/70">CRM</span>
        </span>
      )}
    </Link>
  );
}

/** Desktop: a navy rail that collapses to icons and remembers it. */
export function Sidebar({ initialCollapsed }: { initialCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `rn_nav=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <>
      <aside
        className={`sticky top-0 hidden h-dvh flex-none flex-col bg-navy px-3 py-5 transition-[width] duration-150 lg:flex ${
          collapsed ? "w-[72px]" : "w-[232px]"
        }`}
      >
        <Brand collapsed={collapsed} />
        <div className="mt-7 flex-1 overflow-y-auto">
          <NavList collapsed={collapsed} />
        </div>
        <button
          type="button"
          onClick={toggle}
          className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-navy-fg/70 hover:bg-white/5 hover:text-white ${
            collapsed ? "justify-center px-0" : ""
          }`}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          {!collapsed && "Collapse"}
        </button>
      </aside>

    </>
  );
}

/** Phones and tablets: a menu button that opens the same navigation as a drawer. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="grid size-9 place-items-center rounded-lg border border-line bg-surface text-ink lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="size-[18px]" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-navy/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[260px] flex-col bg-navy px-3 py-5 shadow-lift">
            <div className="flex items-center justify-between">
              <Brand collapsed={false} />
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-navy-fg hover:bg-white/5" aria-label="Close menu">
                <X className="size-[18px]" />
              </button>
            </div>
            <div className="mt-7 flex-1 overflow-y-auto">
              <NavList collapsed={false} onNavigate={() => setOpen(false)} />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
