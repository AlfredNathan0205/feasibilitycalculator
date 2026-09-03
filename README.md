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

