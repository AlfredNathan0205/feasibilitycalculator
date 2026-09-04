# Operational runbook

Practical "how do I actually do X" reference. See `docs/architecture.md`
for the why, `docs/backlog.md` for what's not built yet.

## Environment variables

| Variable                                             | Required      | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                       | Always        | Postgres connection string. On Supabase, use the **Transaction pooler** connection (port 6543) with the IPv4 add-on/toggle enabled — the direct connection and the IPv6-only dedicated pooler both fail to resolve from Vercel's serverless functions. Get it from Supabase's "Connect" dialog, not Project Settings → Database (that page shows the direct connection by default).                                                                                                                        |
| `AUTH_SECRET`                                        | Always        | Any random string (`openssl rand -hex 32`). Used by NextAuth to sign session tokens.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `NEXTAUTH_URL`                                       | Always        | The deployment's own URL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ALLOW_DEV_LOGIN`                                    | Testing only  | Set to exactly `true` to enable the password-less dev-login provider. **Must not be set in any environment real users can reach** — there is no password on this provider, only a dropdown of seeded test users.                                                                                                                                                                                                                                                                                           |
| `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET` / `_ISSUER` | Production    | Entra ID app registration credentials. The Entra provider only registers when all three are present. Untested against a real tenant as of this writing.                                                                                                                                                                                                                                                                                                                                                    |
| `RESEND_API_KEY`                                     | Notifications | API key for sending real notification emails via Resend (`src/lib/resend.ts`). Without it, `dispatchQueuedNotifications` will fail every send attempt — notifications stay queued/failed rather than silently pretending to send.                                                                                                                                                                                                                                                                          |
| `NOTIFICATIONS_FROM_EMAIL`                           | Notifications | The verified sending address/domain in Resend that outgoing notification emails come from.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `CRON_SECRET`                                        | Notifications | Shared secret for `POST /api/notifications/dispatch`. Vercel Cron Jobs are documented to send `Authorization: Bearer $CRON_SECRET` automatically on their own scheduled invocations when this env var is set — **confirm that's still accurate against Vercel's current docs before relying on it**, since this hasn't been independently re-verified here. A manual trigger (e.g. from Claude Code, or a future Admin "send now" button) can call the route the same way by sending the identical header. |

## Running locally

```bash
git clone <repo>
cd feasibilitycalculator
npm install                          # see "known npm gotcha" below
export DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
export ALLOW_DEV_LOGIN=true
export AUTH_SECRET=$(openssl rand -hex 32)
export NEXTAUTH_URL=http://localhost:3000

npm run db:migrate                   # applies drizzle/*.sql in order
npm run seed:apply                   # roles + rule set v1
npx tsx src/db/seed/dev-test-users.ts  # 3 test users with roles, for local testing only

npm run dev                          # http://localhost:3000
```

Sign in via the dropdown on the home page. `am@cpl.example` (Account
Manager), `ppd@cpl.example` (Approver + PPD Manager), `admin@cpl.example`
(Admin) cover the three main roles.

## Known gotchas (things that broke during development, worth knowing before they surprise you again)

- **`npm install typescript` grabs the newest tag, which may be ahead of
  what Next.js supports.** If `npm run dev` fails with "TypeScript X is not
  supported by this version of Next.js," pin to whatever version the error
  message recommends (`npm install -D typescript@^6` was the fix at time
  of writing).
- **Next's webpack bundler doesn't resolve `.js`-extension relative
  imports the way Node's native ESM loader does.** The codebase uses
  explicit `.js` extensions on relative imports throughout (required for
  scripts run directly via `tsx`/`node`, e.g. the seed scripts). `next.config.mjs`
  has a `webpack.resolve.extensionAlias` entry reconciling this — if a new
  route fails to resolve an import that clearly exists, check that config
  is still there before assuming the import itself is wrong.
- **The `xlsx` npm package's default-export resolution is inconsistent
  between Node's native ESM loader and Next's webpack bundler — in
  _opposite_ directions.** Scripts run via `tsx`/`node` need
  `import XLSX from "xlsx"`. Code bundled by Next (API routes, pages) needs
  `import * as XLSX from "xlsx"`. Getting it backwards fails silently at
  the type level and throws at runtime ("does not contain a default
  export" or "Cannot read properties of undefined").
- **Supabase's "Transaction pooler" vs "Session pooler" vs "Direct
  connection" matters, and the UI defaults change.** If `DATABASE_URL`
  errors with `ENOTFOUND`, it's using a hostname Vercel's serverless
  functions can't resolve (direct connection, or the dedicated pooler
  without the IPv4 add-on). If it errors with a password/auth failure and
  the username in the connection string is plain `postgres` rather than
  `postgres.<project-ref>`, the string was built from the wrong pooler
  mode — go back to Supabase's Connect dialog, toggle "Use IPv4
  connection" on, select "Transaction pooler," and copy the whole string
  fresh rather than editing pieces of an old one.
- **Vercel's deployment-protection SSO gate blocks unauthenticated tooling
  (curl, scripts) from any `*.vercel.app` URL**, even the production one,
  unless a custom domain is configured. This is a Vercel platform feature,
  separate from this app's own auth — a human browsing while logged into
  Vercel won't notice it.
- **The Resend API call in `src/lib/resend.ts` has never actually run
  against `api.resend.com`.** The sandbox this was built in only allows
  network egress to a fixed allowlist (package registries, GitHub) and
  `api.resend.com` isn't on it. The request is built strictly to Resend's
  documented shape and the surrounding dispatch logic is verified against
  real Postgres with a stub sender, but the real HTTP call itself needs a
  first real run (e.g. from Claude Code, or by letting Vercel Cron fire it
  once `RESEND_API_KEY`/`NOTIFICATIONS_FROM_EMAIL` are set) before it's
  trusted — treat that first send as the actual verification step, the
  same way the Playwright suite's first run is.

## Rule set changes

Never edit a published rule set's payload directly in the database — it's
enforced immutable at the application layer (not currently at the database
layer; see backlog). The correct path:

1. Admin signs in → **Rule sets** → **New draft** (clones the current
   published payload).
2. Edit values, **Save draft**.
3. **Run replay** — this re-scores every historical brief under the draft
   and reports which decisions would change, grouped by transition (e.g.
   "7 briefs move from Declined to Pending"). Read this before publishing;
   it's the whole point.
4. **Publish** (only enabled in the UI once a replay has run against the
   currently-saved payload — this is a UI-level safeguard, not enforced by
   the API itself as of this writing).

Publishing supersedes whatever was previously published automatically;
there's no separate "unpublish" step.

## Adding or changing a role holder

There's no admin UI for this yet — it's a direct `role_holders` insert:

```sql
INSERT INTO role_holders (role_key, user_id, effective_from)
VALUES ('ppd_manager', '<user-uuid>', CURRENT_DATE);
```

To end someone's tenure in a role without deleting history:

```sql
UPDATE role_holders SET effective_to = CURRENT_DATE
WHERE role_key = 'ppd_manager' AND user_id = '<user-uuid>' AND effective_to IS NULL;
```

Multiple people can hold the same role concurrently (deliberate, for
handover periods) — nothing prevents or warns about this.

## Troubleshooting a "stuck" brief

A brief with `final_status = 'pending'` that never resolves usually means
one of its `approval_requirements` rows is sitting at `state = 'pending'`
with no eligible approver, or at `state = 'rejected'` (which has no
auto-recovery path — see below).

```sql
SELECT ar.*, b.customer_reference
FROM approval_requirements ar
JOIN briefs b ON b.id = ar.brief_id
WHERE b.id = '<brief-id>';
```

- **`state = 'pending'`, no one holds the required role**: check
  `role_holders` for that `required_role_key`. If genuinely no one holds
  it, that's a data problem (add a role holder), not an app bug.
- **`state = 'rejected'`**: there is no rule in the spec for
  auto-recovering from a rejection — this is a deliberate stuck state
  pending human intervention (typically: resubmit a corrected brief). It
  will never resolve to `approved` on its own.
- **`state = 'revoked'`**: this is actionable again, same as `pending` — it
  should already be showing up in the relevant approver's queue. If it
  isn't, that's a real bug (this exact issue happened once during
  development; see `docs/backlog.md`'s account of it), not expected
  behavior.

## Audit trail

`audit_events` is append-only, enforced by both a revoked database
privilege and a trigger (`drizzle/0001_audit_immutability.sql`) — even a
bug in application code cannot rewrite history. If you need to
investigate what happened to a specific brief or requirement:

```sql
SELECT * FROM audit_events WHERE entity_id = '<brief-or-requirement-id>' ORDER BY occurred_at;
```

## Monitoring, logging, backups

None of this is built yet. There is no Application Insights equivalent, no
structured logging beyond Next's default dev-server output, and no backup
policy beyond whatever Supabase does by default on its own plan. This is a
real gap for anything beyond the current testing phase — flagged here so
it isn't quietly assumed to exist.
