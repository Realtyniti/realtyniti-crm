import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { currentMember, getAuthStore } from "@/lib/auth/session";
import { LoginForm, SetupForm } from "./forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in · RealtyNiti CRM" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await currentMember()) redirect("/");
  const { next } = await searchParams;
  const firstTime = (await getAuthStore().countMembers()) === 0;

  if (firstTime) {
    return (
      <AuthShell
        title="Set up your owner login"
        intro="The CRM now gives everyone their own login. Start with yours: you'll be the owner, and you can then add your managers and agents."
      >
        <SetupForm needsKey={!!process.env.ADMIN_PASSWORD || process.env.NODE_ENV === "production"} />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign in" intro="Use the mobile number your login was made with.">
      <LoginForm next={typeof next === "string" ? next : "/"} />
    </AuthShell>
  );
}
