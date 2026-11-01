import Link from "next/link";
import { cookies } from "next/headers";
import { Eye, Plus } from "lucide-react";
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
          <div className="flex items-center justify-center gap-2 border-b border-gold-line bg-gold-soft px-4 py-1.5 text-center text-xs text-gold-ink">
            <Eye className="size-3.5 flex-none" />
            Read-only preview with your real leads. Nothing you change here is saved, and no messages are sent.
          </div>
        )}
        {isDemoStore() && (
          <div className="bg-warm-soft px-4 py-1.5 text-center text-xs text-warm">
            Demo mode: Supabase is not connected, so leads are kept in memory and reset on restart.
          </div>
        )}
        {/* Phones and tablets: the rail becomes a drawer behind this bar. */}
        <header className="sticky top-0 z-30 border-b border-line bg-ground/90 backdrop-blur lg:hidden">
          <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
            <MobileNav />
            <Link href="/" className="font-serif text-[22px] text-ink">
              RealtyNiti<span className="ml-0.5 inline-block size-1.5 rounded-full bg-gold" />
            </Link>
            <Link href="/leads/new" className="btn ml-auto h-9 px-3" aria-label="Add lead">
              <Plus className="size-4" />
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6 lg:px-12 lg:py-9">{children}</main>
      </div>
    </div>
  );
}
