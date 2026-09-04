# Architecture

This describes the system as it actually exists today, not the target
end-state. Where current reality differs from the original build spec
(`Build_Prompt__CPL_Project_Feasibility_Calculator.pdf`), that's called out
explicitly rather than glossed over. See `docs/backlog.md` for what's still
outstanding and `docs/open-questions.md` for genuine ambiguities that need a
business decision.

## Stack

| Layer | Choice | Status |
|---|---|---|
| Framework | Next.js 15, App Router, TypeScript strict | Built |
| UI | React 19, hand-rolled CSS (no Tailwind/shadcn) | Built, functional but plain |
| Auth | NextAuth v5 (Auth.js) | Built — dev-login (Credentials) + Entra ID provider both wired, Entra untested (no real tenant yet) |
| Database | PostgreSQL | Built — currently Supabase, not Azure Database for PostgreSQL |
| ORM | Drizzle ORM, SQL migrations in `drizzle/` | Built |
| Hosting | Vercel | Built — target was Azure App Service |
| Secrets | Vercel environment variables | Built — target was Azure Key Vault |
| Email | Not built | Notifications are queued (outbox pattern) but nothing sends them |
| CI/CD | Not built | No GitHub Actions pipeline yet; deploys are manual pushes to `main` |

**Why Vercel/Supabase instead of Azure**: an explicit, deliberate choice for
the testing phase, not a scope reduction. Postgres is Postgres — moving the
database to Azure Database for PostgreSQL is a connection-string change,
not a rewrite. Moving hosting to Azure App Service is more work (container
packaging, the Bicep templates in the original spec's §14 step 1 don't
exist yet) but doesn't touch application code. The piece that sits outside
either environment is Entra ID itself — nothing here has been tested
against a real Azure AD tenant, since one doesn't exist yet.

## Repository layout

```
src/
  engine/          Pure functions, zero I/O — scoring, decision ladder,
                    Approval Code generation/verification, revoke tokens.
                    This is the most heavily tested code in the repo.
  auth/             Authorization layer (pure) + the one function that
                    resolves a user's roles from the database.
  auth.ts           NextAuth configuration.
  services/         Orchestration: talks to the database, calls the pure
                    engine functions, wraps mutations in transactions.
                    No HTTP concerns here.
  app/              Next.js routes — both pages and API routes. Thin:
                    auth check, call a service function, return.
  db/schema.ts       Drizzle table definitions — the single source of
                    truth for the database shape.
  db/seed/          Seed scripts (roles, rule set v1, dev test users).
drizzle/            Generated + hand-authored SQL migrations.
parity/             The golden dataset + the script that generated it by
                    driving the actual uploaded Excel workbook.
docs/               This file, the runbook, the plain-English rules doc,
                    the backlog, and open questions.
```

The engine/services/app split is deliberate and load-bearing: the engine
has no idea a database or an HTTP request exists, which is what made the
7,776-combination parity test against the real workbook possible without
spinning up infrastructure, and what let the submission form's live score
preview reuse the exact same scoring code client-side with zero
duplication.

## The core pipeline

Every brief goes through four stages, named to match the build spec:

1. **Stage A — commercial decision.** Pure function
   (`engine/decision.ts::computeStageA`). Score the brief, then: Rework (Of
   Selling) or Niche/FF pre-approved → auto-approved; score ≤ 30 →
   declined; score > 115 → auto-approved; otherwise → pending. These
   thresholds are the *current published rule set's* values, not hardcoded
   — see "Rule sets are versioned data" below.

2. **Stage B — required approvals.** Also pure (`computeStageB`).
   Independent of Stage A by design: a commercially auto-approved brief can
   still have outstanding resource approvals. This is the single most
   important structural difference from the original Excel workbook, and
   it's why the UI always shows commercial decision and outstanding
   approvals as two separate facts, never collapsed into one status.

3. **Stage C — pre-approval override.** Per requirement, the submitter can
   declare it already cleared by a named manager (validated against who
   currently holds that role), with a mandatory comment. This immediately
   satisfies that one requirement. A signed, single-use, time-limited
   revoke link lets that manager undo it later — see "Approval Code
   lifecycle" below.

4. **Stage D — final status.** Declined always wins outright, regardless of
   requirement states. Otherwise: any unsatisfied requirement → pending;
   all satisfied → approved, and the Approval Code is issued at that exact
   moment — never earlier.

`services/create-brief.ts` runs Stages A–D at submission time.
`services/decide-requirement.ts` re-runs Stage D whenever a requirement is
later approved, rejected, or revoked, since the brief's status can change
long after submission.

## Rule sets are versioned data, not constants

Every scoring weight, multiplier, threshold, and routing assignment lives
in `rule_sets.payload` (JSONB), not in application code. `rule_sets` rows
are immutable once published — editing produces a new draft, which must be
replayed against every historical brief (reporting exactly which decisions
would change) before it can be published. Publishing supersedes whatever
was previously published; there is always exactly one `published` row.

Version 1's payload was generated by parsing the actual uploaded workbook's
`Reference` sheet programmatically (`db/seed/generate-ruleset-v1.ts`), not
transcribed by hand — see the parity harness below for why that mattered.

## Approval Code lifecycle

Format `FC-YYMM-XXXXX-C`: a fixed prefix, the issuance year/month, five
random Crockford base32 characters, and a weighted-checksum check
character. Crockford's alphabet excludes I/L/O/U for read-aloud clarity,
and lookup normalizes I/L→1 and O→0 so a mistyped code still resolves
where reasonable, while still catching genuine typos and transpositions.

The code is issued exactly once, at the moment a brief becomes fully
clear — never on submission, never on a partial approval. If a
pre-approval is later revoked, the code is stripped unconditionally (not
regenerated later) and the requirement returns to an actionable state
(`revoked`, functionally equivalent to `pending` for decision purposes, kept
as a distinct value purely so the audit trail can show the history).

`GET /verify/[code]` is the audit entry point: available to Admin and
Auditor by role, not by brief ownership — an Auditor can look up any code
without needing to know who submitted it.

## Authorization

A single pure module, `auth/authz.ts`, is the only place role-boundary
logic exists. Every mutating route follows the same shape: authenticate,
call one function from `authz.ts` with the session and the resource being
acted on, then either proceed or return 401/403. Nothing re-implements a
role check inline in a route handler.

The one boundary genuinely worth knowing about: an approver can never
decide a requirement on their own submitted brief, whether they submitted
it themselves or it was submitted on their behalf by a Sales Coordinator.
Detecting this conflict is fully built and tested; *resolving* it (who it
reassigns to) is not, because "line manager" isn't modeled anywhere in the
schema yet — see `docs/open-questions.md` item 2.

## Parity with the original Excel workbook

The single highest-confidence claim in this codebase: the scoring engine
was checked against the actual uploaded workbook across the full
cross-product of inputs specified in the build spec (4 tiers × 3
new/rework × 3 brief types × 2 customer approvals × 2 niche flags × 2
strategic flags × 3 creative approaches × 9 value points = 7,776
combinations), driven through LibreOffice's UNO API, not a hand-written
re-implementation of the formulas. Result: **7,776/7,776 exact score
matches**. Every place the engine's decision *text* legitimately differs
from the workbook's is a documented, intentional deviation, asserted to
differ in the specific expected direction — see `parity/generate_golden_dataset.py`
and `src/engine/parity.test.ts` for the full account, including one
LibreOffice-version compatibility quirk that had nothing to do with the
actual business logic.

## What's deliberately not built yet

See `docs/backlog.md` for the live list. The two gaps most likely to
surprise someone reading only this document: there is no automated
end-to-end test suite (everything has been verified via targeted
integration tests plus manual/scripted live HTTP verification during
development, which is documented per-item in the backlog, but there's no
Playwright suite locking in the three primary user journeys yet), and
notification emails are queued in an outbox table but nothing sends them.
