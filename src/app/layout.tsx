import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { isDemoStore } from "@/lib/store";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Realtyniti CRM",
  description: "Every Realtyniti lead on one card.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        {isDemoStore() && (
          <div className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
            Demo mode: Supabase is not connected, so leads are kept in memory and reset on restart.
          </div>
        )}
        <header className="border-b border-stone-200 bg-white">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="font-semibold tracking-tight">
              Realtyniti
            </Link>
            <Link href="/" className="text-stone-600 hover:text-stone-900">
              Leads
            </Link>
            <Link href="/templates" className="text-stone-600 hover:text-stone-900">
              Templates
            </Link>
            <Link href="/leads/new" className="btn ml-auto">
              Add lead
            </Link>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
