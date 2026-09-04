# Backlog

Tracked against the Build Prompt's §14 sequence and quality gates. Checked
items are done and verified (see README.md for what "verified" means for
each — generally: real Postgres, real HTTP requests, or both, not just unit
tests in isolation). Ordered roughly by priority within each section;
priority order itself may change as items get picked up.

## In progress / up next

- [x] **Notifications: sending is now real, not just queued.** A dispatch
      service (`src/services/notifications/dispatch-notifications.ts`)
      reads queued `notifications` rows, renders the email via a pure
      template renderer (`src/services/notifications/render-email.ts`,
      6/6 unit tests, no DB/network), and sends via Resend
      (`src/lib/resend.ts`, raw `fetch`, no new npm dependency) — resolving
      the "Resend vs. Microsoft Graph" decision in favour of Resend for
      the testing phase, per the handoff's stated fallback. Wired to
      `POST /api/notifications/dispatch`, gated by a `CRON_SECRET` bearer
      check, triggered every 5 minutes by `vercel.json`'s cron schedule.
      **Verified against real Postgres** (10/10 integration tests in
      `dispatch-notifications.test.ts`): a real `pre_approval_declared`
      notification queued by `createBrief` gets sent and marked `sent`
      with `sentAt` set; re-running dispatch does not re-send it; a real
      revoke queues and sends `pre_approval_revoked` to the submitter; a
      throwing send callback marks the row `failed` (not silently
      dropped, not retried automatically); `batchSize` is respected.
      Concurrency safety (`SELECT ... FOR UPDATE SKIP LOCKED` per
      notification, so two overlapping dispatch runs can't double-send)
      is implemented but only reasoned about, not proven under actual
      concurrent load — no test currently forces two real overlapping
      transactions against the same row.
      **NOT verified**: the real HTTP call to `api.resend.com` itself —
      this sandbox's network egress allowlist doesn't include that
      domain, so `sendEmailViaResend()` has never actually executed
      against Resend's live API, only been exercised via a stub in tests
      (same category of limitation as the Playwright suite below). First
      real send should be treated as the verification step, the same way
      the e2e suite's first real run is. Also needs, before this is fully
      done: `RESEND_API_KEY` and `NOTIFICATIONS_FROM_EMAIL` set in Vercel,
      and a verified sending domain in Resend.
      The line-manager half of revoke notifications is still blocked on
      `docs/open-questions.md` item 2, as before — only the submitter
      side sends.

## Not started

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

- [x] **Quality gates: ESLint, Prettier, coverage measurement** — all
      clean/passing, confirmed by actually running them, not just adding
      config files. ESLint required working around a real ESLint 9 /
      `eslint-config-next` incompatibility (circular JSON in the
      FlatCompat translation layer) — switched to a native flat-config
      with `typescript-eslint` + `eslint-plugin-react-hooks` directly.
      Caught and fixed a genuine bug in the process: the revoke page
      constructed JSX inside a `try` block, which doesn't actually catch
      rendering errors the way it looks like it would
      (`react-hooks/error-boundaries`). Coverage: `src/engine/` is now
      **100% statements/branches/functions/lines**, matching the spec's
      explicit "100% branch coverage" requirement for the engine — closed
      via 6 new tests for real gaps, not coverage-gaming, the most
      notable being that **the GCMS resource-approval trigger had never
      been tested at all, anywhere**, before this pass. `services/` sits
      at ~86% branch, which is fine — the spec's 100% mandate was
      specific to the engine. Also fixed a real Vitest/Playwright config
      collision along the way (Vitest's default glob also matches
      `*.spec.ts`, so it was trying — and failing — to collect the
      Playwright e2e files as its own tests).

## Written but NOT verified (a real, flagged limitation)

- [ ] **Playwright e2e suite** — `playwright.config.ts` +
      `e2e/*.spec.ts` cover the exact three journeys the spec names
      (submit→auto-approve; submit→route for approval→approve;
      submit→pre-approval→revoke), written carefully against the actual
      component markup (exact selectors, exact copy). **`cdn.playwright.dev`
      is blocked by this sandbox's network egress allowlist, so the
      browser binary cannot be downloaded here and these tests have never
      actually been run.** This is called out prominently in
      `playwright.config.ts`'s docstring and in each spec file's comment
      block. Unlike everything else in this project, these are NOT
      confirmed passing — the first real run (on a machine with normal
      internet access, e.g. via Claude Code) should be treated as the
      actual verification step, and some selector/timing fixes on that
      first run would not be surprising.

- [x] **docs/**: architecture note (`architecture.md`), operational
      runbook (`runbook.md`), and a plain-English rules document for Simon
      (`rules-for-simon.md`) — §14 step 9. All three grounded in what's
      actually built and the real seeded v1 values (verified against
      `ruleset-v1.generated.json` directly rather than recalled from
      memory), not aspirational descriptions of the original spec. The
      runbook includes every real gotcha hit during development (the
      TypeScript version pin, the `.js`-extension webpack resolution fix,
      the `xlsx` package's inconsistent default-export behaviour, the
      Supabase pooler mode confusion) rather than a generic "how to run
      Next.js" — the point is to save the next person from re-discovering
      the same failures. The rules document deliberately omits anything
      not yet actually working (real email sending) rather than
      describing the intended future state as if it exists now.

- [x] **Dashboard, reporting, CSV/XLSX export** (§9) — all six panels
      built and integration-tested (9/9) against the real accumulated
      dataset (245 briefs by the end): volume by tier and requirement
      type, outcome mix by month, approval rate + median time-to-decision
      per role, score distribution vs. current thresholds, pre-approval
      usage with revocations highlighted, short-deadline volume over
      time. Confirmed live over real HTTP as Admin: dashboard renders all
      panels, `/api/reports/summary` returns correct aggregates (spot-
      checked one against a manual `psql` count), wrong-role access
      correctly blocked (403).
      **Caught and fixed a real bug during live verification**: the XLSX
      export threw a 500 (`Cannot read properties of undefined
  (reading 'utils')`) — the `xlsx` package's default-export
      resolution is inconsistent between Next's webpack bundler and
      Node's native ESM loader (the opposite failure mode from the one
      hit in Phase 1's `generate-ruleset-v1.ts`, which needed the
      opposite import style). Fixed, then read the exported file back
      with a fresh `xlsx` parse to confirm it's genuinely valid data (245
      rows), not just a 200 with an empty/corrupt body.

- [x] **Rule set editor + replay simulation** (§7) — full lifecycle
      proven live over real HTTP against real Postgres, not just tests:
      created a draft via the API, edited its thresholds, ran replay
      against **197 real accumulated historical briefs** (correctly
      surfacing genuine drift, including from an actual threshold
      corruption earlier in this session — a good real-world proof the
      mechanism works, not a synthetic case), published it, and confirmed
      exactly one `published` row exists afterward with the prior one
      correctly `superseded`. 8/8 integration tests against real Postgres.
      **Caught and fixed a test-isolation bug while building this**: an
      early version of the integration tests published an intentionally
      broken rule set (to prove publish takes effect) without restoring
      the original afterward, which silently corrupted the shared
      database for every other test file run afterward — fixed with a
      proper `afterAll` restore, and hit the same issue again live during
      manual verification (restored via direct DB update both times).
      **Known limitation, not yet closed**: "show replay before publish
      can happen" is currently enforced only in the UI (the Publish button
      is disabled client-side until a replay has run against the
      currently-saved payload) — the `POST /api/rule-sets/:id/publish`
      route itself does not independently verify a replay was run, so a
      direct API call could bypass it. Admin is already a narrow, trusted
      role, so this is a workflow safeguard against mistakes more than a
      security boundary, but it's not a hard guarantee as written.

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
- [x] Approver queue + decide-requirement (approve/reject) — a brief
      can now actually move from pending to approved after submission.
      8/8 integration tests against real Postgres; confirmed live over
      HTTP: approved a real pending requirement, code issued at exactly
      the moment the last outstanding requirement cleared (not before);
      confirmed a two-requirement brief only issues its code once BOTH
      clear; confirmed self-approval and wrong-role attempts are blocked
      (403) and re-deciding an already-decided requirement is rejected
      (400) — all via real requests, not just unit tests.
- [x] **Stage C: pre-approval declaration + revoke path** — the full
      lifecycle proven live end-to-end, not just unit tested: submitted a
      brief with an inline pre-approval declaration (real manager-role
      validation against role_holders) → code issued immediately →
      followed the actual public revoke confirmation page (no auth,
      possession-of-token security model) → confirmed via `/verify` the
      code genuinely stopped resolving → confirmed the same revoke link
      used twice fails the second time (single-use) → approved the
      resulting requirement through the real approver queue → a **new**
      code issued. 12/12 + 8/8 integration tests against real Postgres.
      Caught and fixed one real bug along the way during live
      verification (not caught by the unit tests, which only checked the
      service function directly): a revoked requirement didn't show up in
      `listPendingRequirementsForRoles` (only queried `state='pending'`)
      and `decideRequirement` rejected deciding anything not in state
      `pending`, so a revoked requirement was invisible to approvers and
      permanently undecidable — fixed both, added a regression test.
