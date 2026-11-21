import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/team-actions";
import { Avatar } from "@/components/badges";
import { AlertsCard, InstallCard } from "@/components/pwa/pwa";
import { requireMember } from "@/lib/auth/session";
import { ROLE_LABEL, ROLE_SUMMARY } from "@/lib/auth/roles";
import { formatPhone } from "@/lib/lead-display";
import { vapidPublicKey } from "@/lib/push";
import { isReadOnly } from "@/lib/read-only";
import { ChangePasswordForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const me = await requireMember();
  const { welcome } = await searchParams;

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="page-title">My account</h1>

      {welcome && (
        <div className="rounded-2xl border border-good/30 bg-good-soft px-4 py-3 text-[13.5px] text-good">
          You&apos;re signed in, {me.name.split(" ")[0]}. Install the app on your phone and switch on alerts below so you hear about new leads.
        </div>
      )}

      <section className="panel flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar name={me.name} size="lg" />
          <div>
            <div className="text-[16px] font-semibold text-ink">{me.name}</div>
            <div className="text-[13px] text-muted">
              {ROLE_LABEL[me.role]} · {formatPhone(me.phone)}
            </div>
            <div className="mt-0.5 text-[12.5px] text-faint">{ROLE_SUMMARY[me.role]}</div>
          </div>
        </div>
        <form action={logoutAction}>
          <button className="btn-ghost">
            <LogOut className="size-4" />
            Sign out
          </button>
        </form>
      </section>

      <section className="panel">
        <h2 className="eyebrow mb-3">Install on this phone</h2>
        <p className="mb-3 text-[13px] text-muted">The CRM works as an app on Android and iPhone: its own icon, full screen, no Play Store needed.</p>
        <InstallCard />
      </section>

      <section className="panel">
        <h2 className="eyebrow mb-3">New-lead alerts</h2>
        <p className="mb-3 text-[13px] text-muted">
          {me.role === "agent"
            ? "Get an alert on this device when a lead is assigned to you."
            : "Get an alert on this device the moment a new lead comes in."}{" "}
          Alerts show the buyer&apos;s name and requirement, never their phone number. Switch them on separately on each device.
        </p>
        <AlertsCard vapidKey={vapidPublicKey()} disabled={isReadOnly()} />
      </section>

      <section className="panel">
        <h2 className="eyebrow mb-3">Password</h2>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
