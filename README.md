# Realtyniti CRM

Every Realtyniti lead on one card, built from the Realtyniti AI Systems Blueprint (BOA-2026-REA-01).

## Build phases

| Phase | What | Blueprint systems | Status |
|---|---|---|---|
| 1 | **Foundation:** Lead Card database, Intake SOP rules, approved templates with price guard, website and Meta lead-form intake, leads screen | F-00, SYS-01 | **Built** |
| 2 | **Lead Catcher on WhatsApp:** first reply within minutes, five questions one at a time, hot/warm/cold tag, hot-lead alert and morning digest | SYS-02 | **Built** (needs WhatsApp keys to go live) |
| 3 | **Pipeline Board + Site Visit Booker**, import of existing leads | SYS-03, SYS-04 | **Built** |
| 4 | **Follow-up Clock, Project Sheet SOP, Channel Board** | SYS-05, SYS-06, SYS-07 | **Built** |
| 5 | **Months 4–12:** Project Book, Match Finder, Freshness Check, then Niti, Lead Keeper, Project Keeper | | Match Finder + Freshness Check **built**; AI assistants next |

## Guardrails built in

- Price, payment plan, discount and offer never go out automatically. `src/lib/price-guard.ts` blocks them in templates and in filled messages, and flags a card for Chetan when a buyer asks (English and Hinglish).
- Templates must be approved once before use; editing the text withdraws approval (also enforced by a database trigger).
- One phone number = one card. The same client arriving from two platforms adds to the existing card and never wipes a known answer.
- A lead cannot be closed as lost without a reason (also a database constraint).

## What Chetan still needs to supply

The rules in `src/lib/intake-sop.ts` are **placeholders** taken from the blueprint's examples:
the five qualifying questions in his order, the hot/warm/cold rules, and the follow-up cadence.
Replace them with his own wording; everything else reads from that file.

## Lead Catcher (Phase 2)

- A message to the Realtyniti WhatsApp number creates or updates the card, sends the approved first reply,
  then asks the five questions one at a time (Hinglish if the buyer writes in Hinglish) and a site-visit question.
- Hot: the buyer is told Chetan will call, and Chetan gets a WhatsApp alert with the requirement.
  Warm: approved project overview (no figures). Cold: polite close, slow nurture list.
- Price, EMI, discount or offer from the buyer: one approved holding reply, an alert to Chetan, then silence until he clears the flag.
- Meta and website leads get a Meta-registered opener template (WhatsApp only allows templates for first contact);
  the questions start when they reply.
- 9 AM IST digest to Chetan via Vercel Cron (`vercel.json`).
- Any template Chetan has not approved is held and noted on the card instead of being sent.

## Pipeline Board and Site Visit Booker (Phase 3)

- `/board`: follow-ups due today (soonest deciders first), money questions, scheduled visits, new leads,
  upcoming follow-ups, converted, lost grouped by reason, and a source-wise table.
- `/visits`: Chetan opens slots (date, start, length, how many in a row, area, address, map link, visitors per slot).
- `/book/<token>`: the buyer's personal, signed link. Only open slots at least 2 hours ahead; pickup from
  Noida Sector 18 or Pari Chowk; re-booking moves the visit and frees the old slot. Hot leads get the link automatically.
- Confirmation on WhatsApp, alert to Chetan, reminders the evening before (after 6 PM IST) and 2 hours before
  (hourly Supabase pg_cron call to `/api/cron/hourly`).
- `/import`: paste existing leads from Excel or Google Sheets; duplicates merge by phone, lost rows need a reason,
  and nobody is messaged.

## Follow-up Clock, Project Sheet, Channel Board (Phase 4)

- Follow-up Clock (hourly, 10 AM–7 PM IST): on a lead's follow-up date sends the approved `followup.<tag>` message,
  sets the next date from the intake cadence, and stops with a flag for Chetan after two unanswered follow-ups or
  whenever money comes up. Outside WhatsApp's 24h window it uses `WHATSAPP_FOLLOWUP_TEMPLATE`, or leaves the lead on
  Chetan's due list. "I followed up" on the lead card resets it.
- `/projects`: the fixed Project Sheet fields per developer project, green/amber/red freshness (14/30 days in
  `src/lib/projects.ts`), offers ending soon, a client summary with the confirmation date beside every figure, a
  developer re-confirmation WhatsApp draft, and a 2–3 project comparison note. All drafts; nothing is sent.
- `/channels`: enquiries, qualified, hot, visits and median first-reply time per channel for the week or month;
  enter monthly spend to see rupees per qualified lead and per site visit.

## Match Finder and Freshness Check (Phase 5, first part)

- `/match` (or "Find matching projects" on a lead card): ranks Project Book entries by budget, location, property
  type and ready-to-move for urgent buyers; near misses (slightly over budget, other location, missing type) listed
  apart; sold-out projects excluded; stale figures say who to confirm with. Draft shortlist message for Chetan to check.
- Freshness Check on each project: enter the developer's reply, see old and new figures side by side, accept each
  change; only accepted figures are written and the project turns green.
- The 9 AM digest now also lists offers ending within 3 days and projects to re-confirm.

## Run locally

```bash
npm install
npm run dev          # demo mode: in-memory data, no password
npm test
```

## Go live

1. Create a Supabase project and run `supabase/migrations/0001_lead_card.sql`.
2. Deploy to Vercel and set the variables in `.env.example`.
3. Website form: POST JSON to `/api/intake/website` with header `x-intake-key: $INTAKE_SECRET`.
   Fields: `name, phone, email, budget, location, property_type, purpose, timeline, message, submission_id`.
4. Meta lead ads: in the Meta app, subscribe the Page to the `leadgen` webhook at `/api/intake/meta`
   with `META_VERIFY_TOKEN`; give a Page access token with `leads_retrieval`.
5. WhatsApp Cloud API: point the app's WhatsApp webhook at `/api/whatsapp` (field `messages`) with
   `WHATSAPP_VERIFY_TOKEN`; set the phone number id, a permanent system-user token, and register the
   opener and alert templates in WhatsApp Manager.
