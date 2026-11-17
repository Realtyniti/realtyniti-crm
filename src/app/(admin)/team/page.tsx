import { Avatar } from "@/components/badges";
import { requirePermission, getAuthStore } from "@/lib/auth/session";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/lead-display";
import { isReadOnly } from "@/lib/read-only";
import { getStore } from "@/lib/store";
import { AddMemberForm, MemberControls } from "./forms";

export const dynamic = "force-dynamic";

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const me = await requirePermission("team");
  const { welcome } = await searchParams;
  const auth = getAuthStore();
  const [members, devices, leads] = await Promise.all([auth.listMembers(), auth.countSessions(), getStore().listLeads()]);
  const openLeads: Record<string, number> = {};
  const allLeads: Record<string, number> = {};
  for (const l of leads) {
    if (!l.assigned_to) continue;
    allLeads[l.assigned_to] = (allLeads[l.assigned_to] ?? 0) + 1;
    if (l.status !== "converted" && l.status !== "lost") openLeads[l.assigned_to] = (openLeads[l.assigned_to] ?? 0) + 1;
  }
  const unassigned = leads.filter((l) => !l.assigned_to && l.status !== "converted" && l.status !== "lost").length;
  const active = members.filter((m) => m.active);
  const readOnly = isReadOnly();

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="page-title">Team</h1>
        <p className="mt-1 text-sm text-muted">
          Everyone signs in with their own mobile number and password. Deactivate blocks a login on every phone and computer straight
          away; their leads stay here for you to hand to someone else.
        </p>
      </div>

      {welcome && (
        <div className="rounded-2xl border border-good/30 bg-good-soft px-4 py-3 text-[13.5px] text-good">
          Your owner login is ready, {me.name.split(" ")[0]}. From now on the old shared password no longer opens the CRM. Add your team below.
        </div>
      )}
      {readOnly && (
        <div className="rounded-2xl border border-gold-line bg-gold-soft px-4 py-3 text-[13px] text-gold-ink">
          This is a read-only preview. You can look around, but add or change people on the live CRM.
        </div>
      )}

      <section className="panel">
        <h2 className="eyebrow mb-3">Add a person</h2>
        <AddMemberForm disabled={readOnly} />
      </section>

      <section className="panel p-0">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="eyebrow">People ({active.length} active)</h2>
          {unassigned > 0 && <span className="text-[12.5px] text-muted">{unassigned} open leads unassigned</span>}
        </div>
        <ul className="divide-y divide-line border-t border-line">
          {members.map((m) => (
            <li key={m.id} className={`flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between ${m.active ? "" : "bg-subtle/60"}`}>
              <div className="flex min-w-0 items-start gap-3">
                <Avatar name={m.name} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{m.name}</span>
                    <span className="rounded-full bg-subtle px-2 py-0.5 text-[11.5px] font-medium text-ink-2">{ROLE_LABEL[m.role]}</span>
                    {!m.active && <span className="rounded-full bg-hot-soft px-2 py-0.5 text-[11.5px] font-semibold text-hot">Deactivated</span>}
                    {m.active && !m.has_password && (
                      <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[11.5px] font-medium text-gold-ink">Link not used yet</span>
                    )}
                    {m.id === me.id && <span className="text-[12px] text-muted">(you)</span>}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-muted">
                    {formatPhone(m.phone)} · {openLeads[m.id] ?? 0} open lead{openLeads[m.id] === 1 ? "" : "s"}
                    {m.active && ` · signed in on ${devices[m.id] ?? 0} device${devices[m.id] === 1 ? "" : "s"}`}
                  </div>
                  <div className="text-[12px] text-faint">
                    {m.active
                      ? m.last_login_at
                        ? `Last sign-in ${formatDateTime(m.last_login_at)}`
                        : "Has not signed in yet"
                      : m.deactivated_at && `Deactivated ${formatDateTime(m.deactivated_at)}`}
                  </div>
                </div>
              </div>
              {m.role !== "owner" && (
                <div className="sm:max-w-[60%]">
                  <MemberControls
                    member={{ id: m.id, name: m.name, role: m.role, active: m.active }}
                    others={active.filter((o) => o.id !== m.id).map((o) => ({ id: o.id, name: `${o.name} (${ROLE_LABEL[o.role]})` }))}
                    leadCount={allLeads[m.id] ?? 0}
                    disabled={readOnly}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
