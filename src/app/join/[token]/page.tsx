import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { JoinForm } from "@/app/login/forms";
import { getAuthStore } from "@/lib/auth/session";
import { inviteFor } from "@/lib/auth/team";
import { ROLE_LABEL, ROLE_SUMMARY } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set your password · RealtyNiti CRM", robots: { index: false } };

/** The one-time link the owner sends a new team member (or after a password reset). */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const member = await inviteFor(getAuthStore(), token);

  if (!member) {
    return (
      <AuthShell title="This link has expired" intro="Links work once and for 7 days. Ask the owner to send you a new one.">
        <Link href="/login" className="btn-ghost h-11 w-full">
          Go to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Welcome, ${member.name.split(" ")[0]}`}
      intro={
        <>
          You&apos;re joining RealtyNiti CRM as <b className="font-semibold text-ink">{ROLE_LABEL[member.role]}</b>. {ROLE_SUMMARY[member.role]} You&apos;ll
          sign in with your mobile number and the password you choose here.
        </>
      }
    >
      <JoinForm token={token} />
    </AuthShell>
  );
}
