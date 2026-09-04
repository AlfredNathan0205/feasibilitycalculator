# CPL Project Feasibility Calculator — DB schema & rule-set seed

This is phase 1 of the build sequence in the spec (§14): "Database schema and
migrations, plus the version 1 rule set seed generated from the workbook's
Reference sheet." Everything here has been run for real against a local
PostgreSQL 16 instance, not just written and assumed to work — see
"What's been verified" below.

## Layout

```
src/db/schema.ts                       Drizzle ORM schema — the 9 tables from spec §8
drizzle/0000_init.sql                  Generated migration (tables, enums, FKs, indexes, CHECKs)
drizzle/0001_audit_immutability.sql    Hand-authored: append-only trigger for audit_events
src/db/seed/roles.ts                   The 5 access roles + 5 known approval-authority roles (§2)
src/db/seed/generate-ruleset-v1.ts     Reads Reference!/Calculator! cells directly from the
                                        workbook and emits ruleset-v1.generated.json — no
                                        hand-transcribed values (§10 item 1)
src/db/seed/ruleset-v1.generated.json  Output of the above, generated from the actual uploaded
                                        workbook — inspect/diff this before it's ever loaded
src/db/seed/apply-seed.ts              Loads roles + publishes rule set v1 from the JSON above
```

## What's been verified (not just written)

- `npx tsc --noEmit` passes in strict mode across the whole package.
- `drizzle-kit generate` produced `0000_init.sql` from `schema.ts` directly —
  the SQL is generated, not hand-written, so it can't drift from the schema.
- Migrations were applied to a real local PostgreSQL 16 database
  (`drizzle-kit migrate`), not just eyeballed.
- Confirmed live, against that database:
  - `audit_events` **rejects UPDATE** with `audit_events is append-only: UPDATE is not permitted (row id …)`.
  - Inserting a brief with `strategic_priority = true` and no rationale
    **fails** the `briefs_strategic_priority_rationale_ck` constraint; the
    same insert **succeeds** once a rationale is supplied.
  - Inserting a brief with `deadline = CURRENT_DATE` (not future) **fails**
    the `briefs_deadline_future_ck` constraint, matching §5's "a deadline on
    or before today is a validation error."
- `generate-ruleset-v1.ts` was run against the actual uploaded
  `Project-Feasibility-Calculator.xlsx` (not a fixture) and its output
  matches the values I hand-verified by inspecting the workbook directly:
  tier weights 100/50/25/10, New/Rework multipliers 1/1/0, brief type
  1/0/−0.5, customer approval 0.5/0, creative approach 100/65/0, thresholds
  115/30.
- `apply-seed.ts` was run twice against the same database: the second run
  correctly reported "Rule set version 1 already exists — skipping insert"
  and re-upserted roles without duplicating them — confirmed idempotent.

## Deliberate choices worth knowing about

- **`deadlineWindowDays = 14` is hardcoded in the generator script, not read
  from the sheet.** The workbook's own formula (`Calculator!E13`) still says
  `TODAY()+21` — confirmed stale by Simon in writing. Reading it from the
  sheet would silently reintroduce the bug the rebuild is meant to fix. This
  is called out loudly in a comment at the point of use, per §11's
  instruction to document every deviation at the point of implementation.
- **The routing table is seeded but not final.** `development_director` and
  `commercial_director` assignments are provisional pending Pauline Holmes's
  guidance (§12 item 1) — they're plain rows in the JSONB payload, not code,
  so they can change with a new draft rule set and no redeploy.
- **Two routing rules are seeded `enabled: false`**: `tier_auto_approval` and
  `strategic_priority_deferral`. These implement §11 items 2 and 3 — the
  workbook's live behaviour is the default (tier T scores as A with no extra
  approval; strategic priority adds 100 points with no approval), while the
  discarded draft's alternative behaviour exists as an available, disabled
  routing rule rather than being unimplementable later.
- **A placeholder "system" user is inserted** so `rule_sets.created_by` /
  `published_by` have somewhere to point for the v1 seed, since no real Entra
  user exists yet at this stage of the build. This needs replacing once
  Auth is built (§14 step 4) — flagging here so it isn't forgotten.
- **`role_holders` intentionally has no "one current holder" constraint** —
  the spec asks explicitly for support of "multiple holders and handovers
  without losing history," so two people can hold `ppd_manager`
  simultaneously (e.g. during a handover) and old rows are never deleted.

## Genuinely open (carried over from the spec, not decided here)

- Pauline Holmes's routing guidance (§12 item 1) — blocks nothing, drops
  straight into `routingTable` when it arrives.
- Who holds `admin` in practice (§12 item 4) — a data question (rows in
  `role_holders`), not a schema question, so it's not blocking either.

## Running it yourself

```bash
export DATABASE_URL=postgresql://user:pass@host:5432/dbname
npm install
npm run db:migrate
npm run seed:generate-ruleset -- /path/to/Project-Feasibility-Calculator.xlsx
npm run seed:apply
```

---

# Phase 2 — Pure scoring/decision engine + parity harness (§10 checkpoint)

The spec is explicit that nothing after this point should be built until
parity is proven ("Checkpoint: do not proceed until parity is proven"), so
this was built next regardless of which later phase (API/UI) comes after.

## Layout

```
src/engine/scoring.ts                  Pure §3 scoring model
src/engine/decision.ts                 Pure §5 Stage A (commercial decision) + Stage B (required approvals)
src/engine/tier-tipping-points.ts      §10's required "tier tipping-point table" build artefact
src/engine/*.test.ts                   Unit tests (vitest)
src/engine/parity.test.ts              Compares the engine against parity/golden-dataset.csv
parity/generate_golden_dataset.py      Drives the REAL workbook via LibreOffice's UNO bridge
parity/golden-dataset.csv              Its output: 7,776 rows, the full cross-product from §10 item 2
docs/open-questions.md                 Ambiguities documented rather than silently resolved (§15)
```

## Results

- **Score parity: 7,776/7,776 exact matches**, generated by actually driving
  the uploaded workbook (not reimplementing its formulas in Python) via
  LibreOffice's UNO API, across the full cross-product §10 item 2 specifies:
  4 tiers × 3 new/rework × 3 brief types × 2 customer approvals × 2 niche
  flags × 2 strategic flags × 3 creative approaches × 9 values.
- **Decision parity: 7,408 exact matches, 368 classified expected
  deviations, 0 unexpected mismatches.** Every deviation is asserted to
  differ in a specific, named direction — see the long comment at the top
  of `parity.test.ts` for the three categories (exactly-30 boundary, the E9
  creative-approval structural change, and a boundary case at exactly 115
  that isn't in §11's list but follows directly from the spec's own §3
  wording — logged in `docs/open-questions.md`).
- **Tier tipping points reproduce the spec's own stated figures exactly**:
  £30,001 / £130,001 / £180,001 / £210,001 for A/T/B/C/D against the spec's
  "around £30k / £130k / £180k / £210k" — a strong independent check that
  the engine's arithmetic is right, derived completely separately from the
  parity harness.
- One deliberately **skipped** test documents the tier-T ambiguity
  (`docs/open-questions.md` item 1) rather than guessing at an
  interpretation.

## A real bug the harness caught (in the harness itself, not the engine)

The first parity run failed with a score mismatch: engine `200.0035` vs.
workbook `"200"`. The cause was reading the workbook's score cell with
`getString()`, which applies Calc's display number format (rounding to 0
decimals) rather than returning the underlying double. Fixed by switching to
`getValue()` for the score column in `generate_golden_dataset.py`. This is
exactly the kind of thing the parity harness exists to catch — including in
its own tooling.

## Environment note: LibreOffice XLOOKUP compatibility shim

This sandbox's LibreOffice (24.2) predates native XLOOKUP support (added in
24.8), so the workbook's `_xlfn.XLOOKUP` formulas evaluated to `#NAME?`,
silently swallowed by `IFERROR` into blanks. For golden-dataset generation
only, the five affected formula cells are rewritten in-memory to the
mathematically identical `INDEX/MATCH` exact-match equivalent before
recalculating — verified against a hand-computed example (A/T, £200k, New,
Exclusive, Direct, Library Only → 900) before trusting it for the full run.
The uploaded workbook itself is never modified; this only affects the
transient in-memory copy used to generate the golden CSV. See the comment
block in `parity/generate_golden_dataset.py` for the full explanation — a
production environment with LibreOffice ≥24.8, or Excel itself, wouldn't
need this at all.

## Running it yourself

```bash
npm test                                    # unit + parity tests
npm run tier-tipping-points                 # prints the tipping-point table

# Regenerating the golden dataset (requires LibreOffice + python3-uno):
soffice --headless --accept="socket,host=localhost,port=2002;urp;" &
python3 parity/generate_golden_dataset.py /path/to/workbook.xlsx parity/golden-dataset.csv
```

---

# Phase 3 — Auth, roles, and the authorization layer (§14 step 4)

## Layout

```
src/auth/authz.ts                  Pure authorization layer — every role boundary from §2
src/auth/authz.test.ts             18 tests covering every boundary, including self-approval
src/auth/resolve-session-roles.ts  The ONLY DB-touching piece: resolves role_holders -> session roles
src/auth.ts                        NextAuth v5 config: Entra ID (prod) + gated dev-login (local testing)
src/types/next-auth.d.ts           Type augmentation for session.accessRoles / approvalAuthorityRoles
src/app/page.tsx                   Dev-login form (local only) / signed-in status page
src/app/api/auth/[...nextauth]/    NextAuth route handler
src/app/api/whoami/route.ts        Protected route proving the whole chain works
src/db/seed/dev-test-users.ts      Seeds 3 test users with distinct roles for local dev-login testing
```

## Two sign-in paths, one authorization layer

- **Production**: Microsoft Entra ID via NextAuth's provider, PKCE, only
  registered when `AUTH_MICROSOFT_ENTRA_ID_ID/SECRET/ISSUER` are all set.
- **Local testing** (what you asked for): a Credentials provider that's
  **only ever registered when `ALLOW_DEV_LOGIN=true` is explicitly set** —
  deliberately a separate flag from `NODE_ENV`, so a misconfigured
  deployment can't silently expose it. It has no password: you pick one of
  the seeded test users from a dropdown. This is fine for local-only
  testing and must never be set in any deployed environment — the page
  itself displays a warning to that effect.

Both paths feed the exact same `jwt` callback, which calls
`resolveSessionRoles()` — the only place role information is read from the
database — and bakes the result into the session token server-side. The
`authz.ts` functions never see a client-supplied claim, only this
server-resolved session (§2: "Never trust a role claim read on the
client").

## What's verified (not just written)

- **All 41 unit/parity tests pass** (1 documented skip), including 18 tests
  in `authz.test.ts` covering every role boundary in §2: the Admin-only
  threshold-editing gate, the "approver access role AND the specific
  approval-authority role" double-check, and 8 dedicated tests for the
  self-approval prohibition (submitter, on-behalf-of Account Manager,
  unrelated approver, wrong-authority approver, and the combined gate).
- **Ran the actual dev server and signed in as two different seeded test
  users via real HTTP requests** (curl, following NextAuth's real
  CSRF-token + credentials-callback flow — not a mocked client):
  - `ppd@cpl.example` → session correctly resolved to
    `accessRoles: ["approver"], approvalAuthorityRoles: ["ppd_manager"]`.
  - `admin@cpl.example` → correctly resolved to `accessRoles: ["admin"]`,
    empty approval-authority roles.
  - The two sessions were independently verified via `/api/whoami` to
    confirm no role leakage between them.
  - An unauthenticated request to `/api/whoami` correctly got `401 {"error":
"Not signed in"}`.

## A real environment issue found and fixed along the way

`npm install` pulled TypeScript 7.0.2 (the newest tag), which Next.js 15
doesn't support ("the native compiler does not provide the JavaScript
compiler API Next.js requires") — pinned to `typescript@^6`. Separately,
Next's webpack bundler doesn't resolve the `.js`-extension relative imports
the rest of this package uses (required for Node's native ESM loader when
scripts run directly via `tsx`, e.g. the seed scripts) — fixed with a
`resolve.extensionAlias` entry in `next.config.mjs` rather than restructuring
every import, so both consumption paths (Next's bundler and direct
`tsx`/`node` execution) work from the same source files.

## Genuinely open — carried over, not resolved here

`docs/open-questions.md` item 2: the spec says a self-approval conflict
should "reassign to their line manager role," but no line-manager
relationship exists anywhere in the data model. `checkSelfApproval()` /
`requireCanDecideRequirement()` reliably **detect** the conflict and block
the action (with a message pointing at this doc); they deliberately do not
attempt to guess a reassignment target. This needs a decision from Simon
before the reassignment half of the rule can be built.

## Running it locally

```bash
export DATABASE_URL=postgresql://user:pass@localhost:5432/cpl_feasibility
export ALLOW_DEV_LOGIN=true
export AUTH_SECRET=$(openssl rand -hex 32)   # any random string works locally
npm install
npm run db:migrate
npm run seed:apply
npx tsx src/db/seed/dev-test-users.ts        # seeds 3 test users with roles
npm run dev
```

Then open **http://localhost:3000** — pick a test user from the dropdown,
sign in, and visit `/api/whoami` to see the resolved session as JSON.

**Before deploying to Azure:** remove `ALLOW_DEV_LOGIN` entirely and set
the three `AUTH_MICROSOFT_ENTRA_ID_*` env vars instead — the dev-login
provider is never registered unless that flag is explicitly `true`, so
simply not setting it is sufficient to disable it in production.

---

# Phase 4 — Approval Code, brief submission, and the verify endpoint (§14 step 5, partial)

## Layout

```
src/engine/approval-code.ts         Generation, check-character, normalization (§6)
src/engine/approval-code.test.ts    16 tests: format, tolerance, and mistyped-code detection
src/services/create-brief.ts        Orchestrates Stage A + Stage B -> persists -> Stage D (§5)
src/services/create-brief.test.ts   8 integration tests against a real Postgres
src/app/api/briefs/route.ts         POST /api/briefs — authz-gated submission endpoint
src/app/verify/[code]/page.tsx      GET /verify/[code] — the §6 audit entry point
```

## What's verified (not just written)

- **16/16 Approval Code tests**, including proof that a single mistyped
  character, a mistyped check character, and an adjacent-character
  transposition are all rejected — and that Crockford's I/L→1, O→0
  look-alike tolerance and case/separator-insensitivity work as specified.
- **8/8 integration tests against a real Postgres**, not mocks — the one
  that matters most: a brief that's commercially Auto-Approved but has an
  outstanding resource-sign-off requirement gets `finalStatus: "pending"`
  and **no Approval Code**, proving §5's central rule ("the UI must never
  show a bare Auto-Approved when resource sign-offs are outstanding") holds
  all the way down to the database, not just in the pure engine.
- **Ran the actual dev server and submitted a real brief over HTTP** as the
  seeded `am@cpl.example` Account Manager: a £200k/A/T/New/Exclusive/Direct/
  Library Only brief scored exactly 900 (matching the hand-verified engine
  test from Phase 2) and got Approval Code `FC-2609-01ZD9-Z` issued
  immediately.
- **Confirmed authorization boundaries live, not just in unit tests**:
  submitting as `admin@cpl.example` (wrong role) → `403`; the same user
  hitting `/verify/[code]` (right role, Admin has audit access) → full
  brief/decision/history rendered; the Account Manager who submitted the
  brief hitting the same `/verify/[code]` URL (no Auditor/Admin role) →
  blocked, even though they own the brief — access here is role-based, not
  ownership-based, exactly as §6 specifies.
- **Confirmed the lookup tolerance live**: `fc-2609-o1zd9-z` (lowercase,
  `O` typed instead of `0`) resolved to the same brief as the canonical
  `FC-2609-01ZD9-Z`.
- Manually cross-checked the resulting rows directly in `psql` rather than
  trusting only the test/HTTP output — `commercial_decision`,
  `final_status`, `approval_code`, and `requirement_count` all lined up
  exactly as expected across auto-approved/zero-requirements,
  auto-approved/pending-requirement, and declined cases.

## What's NOT in this phase (still to come)

This covers submission through to Approval Code issuance for the
zero-or-immediately-clear case. Still needed for the full §14 step 5 scope:
the actual 3-step wizard UI with live score preview (currently there's only
a raw JSON API + a bare server-rendered verify page), the outcome page's
two-part display, and — from step 6 — the approver queue, notifications,
and the Stage C pre-approval/revoke path that moves a _pending_ brief
through to fully clear and issues its code at that later point.

## Running it locally

Same setup as Phase 3, plus:

```bash
# after signing in as an Account Manager or Sales Coordinator test user:
curl -b cookies.txt -X POST http://localhost:3000/api/briefs \
  -H "Content-Type: application/json" \
  -d '{
    "customerReference": "ACME-001", "tier": "A/T", "valuePotentialGbp": 200000,
    "newRework": "New", "briefType": "Exclusive", "customerApproval": "Direct",
    "nicheFfPreApproved": false, "strategicPriority": false,
    "creativeApproach": "Library Only",
    "marketingFlag": false, "ppdFlag": false, "gcmsFlag": false,
    "deadline": "2027-01-01"
  }'
```

Then visit `/verify/FC-...` (signed in as the Admin or Auditor test user) to
see the full audit record.
