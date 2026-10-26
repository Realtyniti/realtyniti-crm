# Realtyniti CRM

Every Realtyniti lead on one card, built from the Realtyniti AI Systems Blueprint (BOA-2026-REA-01).

## Build phases

| Phase | What | Blueprint systems | Status |
|---|---|---|---|
| 1 | **Foundation:** Lead Card database, Intake SOP rules, approved templates with price guard, website and Meta lead-form intake, leads screen | F-00, SYS-01 | **Built** |
| 2 | **Lead Catcher on WhatsApp:** first reply within minutes, five questions one at a time, hot/warm/cold tag, hot-lead alert and morning digest | SYS-02 | Next |
| 3 | **Pipeline Board + Site Visit Booker**, import of existing leads | SYS-03, SYS-04 | |
| 4 | **Follow-up Clock, Project Sheet SOP, Channel Board** | SYS-05, SYS-06, SYS-07 | |
| 5 | **Months 4–12:** Project Book, Match Finder, Freshness Check, then Niti, Lead Keeper, Project Keeper | | |

## Guardrails built in

- Price, payment plan, discount and offer never go out automatically. `src/lib/price-guard.ts` blocks them in templates and in filled messages, and flags a card for Chetan when a buyer asks (English and Hinglish).
- Templates must be approved once before use; editing the text withdraws approval (also enforced by a database trigger).
- One phone number = one card. The same client arriving from two platforms adds to the existing card and never wipes a known answer.
- A lead cannot be closed as lost without a reason (also a database constraint).

## What Chetan still needs to supply

The rules in `src/lib/intake-sop.ts` are **placeholders** taken from the blueprint's examples:
the five qualifying questions in his order, the hot/warm/cold rules, and the follow-up cadence.
Replace them with his own wording; everything else reads from that file.

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
