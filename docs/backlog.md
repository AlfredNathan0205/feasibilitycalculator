# Backlog

Tracked against the Build Prompt's §14 sequence and quality gates. Checked
items are done and verified (see README.md for what "verified" means for
each — generally: real Postgres, real HTTP requests, or both, not just unit
tests in isolation). Ordered roughly by priority within each section;
priority order itself may change as items get picked up.

## In progress / up next

- [ ] **Stage C: pre-approval declaration + revoke path** (§5, §6) — the
      logical next item now that approve/reject exists. Per-requirement
      "already approved by a manager" declaration with named manager +
      mandatory comment; signed, single-use revoke link with a
      configurable window (default 72h); revoking returns the requirement
      to pending and strips any issued Approval Code.

## Not started
- [ ] **Notifications** (§8 `notifications` table exists, nothing sends
      anything yet). Needed for: pre-approval declared (notify nominated
      manager with revoke link), revoked (notify submitter + line
      manager — blocked on the same line-manager gap as
      `docs/open-questions.md` item 2).
- [ ] **Rule set editor + replay simulation** (§7 — spec calls this "a
      first-release requirement, not a later enhancement"). Draft/publish
      workflow, replay a draft rule set against every historical
      submission, group results by outcome transition, before allowing
      publish.
- [ ] **Dashboard, reporting, CSV/XLSX export** (§9). Volume/outcome mix,
      approval rate & time-to-decision per role, score distribution vs.
      thresholds, pre-approval usage/revocations, short-deadline volume
      over time.
- [ ] **docs/**: architecture note, operational runbook, plain-English
      rules document for Simon (§14 step 9). Only `open-questions.md`
      exists today.
- [ ] **Quality gates**: no ESLint/Prettier config exists yet. No test
      coverage measurement. No Playwright e2e suite covering the three
      primary journeys the spec names (submit→auto-approve; submit→route
      for approval→approve; submit→pre-approval→revoke).
- [ ] Bulk-approve for multiple items of the same requirement type in one
      action (§9) — the approver queue built handles one-at-a-time only.
- [ ] **3-step submission wizard** (§9) — currently one page. Not wrong,
      just not what the spec describes; revisit once Stage C exists,
      since step 2 of the real wizard is specifically the per-requirement
      pre-approval declaration.
- [ ] **Azure infra** (§14 step 1, Bicep). Deliberately deferred — testing
      on Vercel/Supabase per explicit direction; Azure comes post-testing.

## Blocked on external input (not code — tracked here so they aren't lost)

- [ ] Pauline Holmes's routing guidance for Commercial/Development
      Director scope (§12 item 1).
- [ ] Tier T ambiguity — no distinguishable input exists for it in the
      live workbook (`docs/open-questions.md` item 1).
- [ ] Line-manager reassignment target for the self-approval conflict —
      no relationship modeled yet (`docs/open-questions.md` item 2).
      Blocks the revoke-notification flow above too.
- [ ] Who holds Admin in practice (§12 item 4).

## Done and verified

- [x] Database schema, migrations, v1 rule set seed (Phase 1)
- [x] Pure scoring/decision engine + parity harness — 7,776/7,776 exact
      score matches against the real workbook (Phase 2)
- [x] Auth, roles, authorization layer — 18/18 role-boundary tests
      including self-approval detection (Phase 3)
- [x] Approval Code generation/verification — 16/16 tests (Phase 4)
- [x] Brief submission (immediate-clear case) + verify endpoint (Phase 4)
- [x] Branded, functional UI: dashboard, submission form with live score
      preview, outcome display, verify pages (Phase 5)
- [x] Live deployment on Vercel + Supabase, confirmed working end-to-end
- [x] **Approver queue + decide-requirement (approve/reject)** — a brief
      can now actually move from pending to approved after submission.
      8/8 integration tests against real Postgres; confirmed live over
      HTTP: approved a real pending requirement, code issued at exactly
      the moment the last outstanding requirement cleared (not before);
      confirmed a two-requirement brief only issues its code once BOTH
      clear; confirmed self-approval and wrong-role attempts are blocked
      (403) and re-deciding an already-decided requirement is rejected
      (400) — all via real requests, not just unit tests.
