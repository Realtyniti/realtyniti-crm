import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy policy · Realtyniti and Tathya Homes" };

/* Public page: Meta requires a privacy policy and data deletion instructions before the app goes Live. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-10 text-stone-800">
      <h1 className="text-2xl font-semibold">Privacy policy</h1>
      <p className="text-sm text-stone-500">Realtyniti and Tathya Homes (Chetan, real estate advisory, Noida). Last updated 26 October 2026.</p>

      <h2 className="pt-2 text-lg font-semibold">What we collect</h2>
      <p>
        When you fill in one of our forms (on Facebook, Instagram, our website or WhatsApp), we keep the details you give us: your name,
        phone number, email, and what you are looking for, such as budget, location, home type and timeline. We also keep the messages
        you send us on WhatsApp.
      </p>

      <h2 className="pt-2 text-lg font-semibold">How we use it</h2>
      <p>
        Only to reply to your enquiry, suggest properties that fit, arrange site visits and follow up with you. We do not sell your
        details or share them with anyone else, except a developer's sales office when you ask us to book a visit or a unit with them.
      </p>

      <h2 className="pt-2 text-lg font-semibold">Where it is kept</h2>
      <p>In our private client records, which only Chetan can open. Data is stored with Supabase and Vercel on secured servers.</p>

      <h2 className="pt-2 text-lg font-semibold">Stopping messages</h2>
      <p>Reply STOP on WhatsApp at any time and we will not message you again.</p>

      <h2 id="delete" className="pt-2 text-lg font-semibold">Deleting your data</h2>
      <p>
        Send us a WhatsApp message asking us to delete your details, from the phone number you gave us. We delete your
        record and messages within 7 days and confirm when it is done.
      </p>

      <h2 className="pt-2 text-lg font-semibold">Contact</h2>
      <p>Chetan, Realtyniti / Tathya Homes, Noida, Uttar Pradesh, India. WhatsApp +91 87662 47768.</p>
    </main>
  );
}
