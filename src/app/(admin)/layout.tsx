import Link from "next/link";
import { cookies } from "next/headers";
import { Eye, Plus, Search } from "lucide-react";
import { MobileNav, Sidebar } from "@/components/shell/sidebar";
import { isReadOnly } from "@/lib/read-only";
import { isDemoStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Every CRM screen except the buyer-facing booking page. */
export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const collapsed = (await cookies()).get("rn_nav")?.value === "collapsed";
  return (
    <div className="flex min-h-dvh">
      <Sidebar initialCollapsed={collapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        {isReadOnly() && (
          <div className="flex items-center justify-center gap-2 bg-navy px-4 py-1.5 text-center text-xs text-navy-fg">
            <Eye className="size-3.5 flex-none" />
            Read-only preview with your real leads. Nothing you change here is saved, and no messages are sent.
          </div>
        )}
        {isDemoStore() && (
          <div className="bg-warm-soft px-4 py-1.5 text-center text-xs text-warm">
            Demo mode: Supabase is not connected, so leads are kept in memory and reset on restart.
          </div>
        )}
        <header className="sticky top-0 z-30 border-b border-line bg-ground/85 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <MobileNav />
            <form action="/leads" className="relative max-w-md flex-1" role="search">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <label htmlFor="global-search" className="sr-only">
                Search leads
              </label>
              <input
                id="global-search"
                name="q"
                type="search"
                placeholder="Search leads by name or phone"
                className="input h-9 rounded-lg pl-9"
              />
              <input type="hidden" name="view" value="all" />
            </form>
            <Link href="/leads/new" className="btn ml-auto h-9">
              <Plus className="size-4" />
              <span className="hidden sm:inline">Add lead</span>
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
