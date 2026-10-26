import Link from "next/link";
import { isDemoStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/board", label: "Board" },
  { href: "/", label: "Leads" },
  { href: "/visits", label: "Site visits" },
  { href: "/projects", label: "Projects" },
  { href: "/channels", label: "Channels" },
  { href: "/templates", label: "Templates" },
  { href: "/import", label: "Import" },
];

/** Chetan's screens: everything except the buyer-facing booking page. */
export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {isDemoStore() && (
        <div className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
          Demo mode: Supabase is not connected, so leads are kept in memory and reset on restart.
        </div>
      )}
      <header className="border-b border-stone-200 bg-white">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
          <Link href="/board" className="font-semibold tracking-tight">
            Realtyniti
          </Link>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-stone-600 hover:text-stone-900">
              {n.label}
            </Link>
          ))}
          <Link href="/leads/new" className="btn ml-auto">
            Add lead
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
