import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, desc } from "drizzle-orm";
import { auth, signIn } from "../auth.js";
import * as schema from "../db/schema.js";
import { AppShell } from "./components/app-shell.js";

const devLoginEnabled = process.env.ALLOW_DEV_LOGIN === "true";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  return drizzle(postgres(databaseUrl), { schema });
}

async function getTestUsers() {
  if (!process.env.DATABASE_URL) return [];
  const db = getDb();
  return db
    .select({ upn: schema.users.upn, displayName: schema.users.displayName })
    .from(schema.users)
    .where(eq(schema.users.active, true));
}

async function getRecentBriefsFor(userId: string) {
  const db = getDb();
  return db
    .select({
      briefId: schema.briefs.id,
      customerReference: schema.briefs.customerReference,
      submittedAt: schema.briefs.submittedAt,
      commercialDecision: schema.decisions.commercialDecision,
      finalStatus: schema.decisions.finalStatus,
      approvalCode: schema.decisions.approvalCode,
      score: schema.decisions.computedScore,
    })
    .from(schema.briefs)
    .innerJoin(schema.decisions, eq(schema.decisions.briefId, schema.briefs.id))
    .where(eq(schema.briefs.submittedBy, userId))
    .orderBy(desc(schema.briefs.submittedAt))
    .limit(10);
}

function StatusPill({ status }: { status: "approved" | "pending" | "declined" }) {
  const label =
    status === "approved" ? "Approved" : status === "declined" ? "Declined" : "Pending";
  return <span className={`status-pill status-${status}`}>{label}</span>;
}

export default async function Home() {
  const session = await auth();

  if (!session) {
    if (!devLoginEnabled) {
      return (
        <AppShell session={null}>
          <div className="container">
            <div className="card" style={{ marginTop: "3rem" }}>
              <h1>CPL Project Feasibility Calculator</h1>
              <p className="helptext">
                No sign-in method is configured. Set the AUTH_MICROSOFT_ENTRA_ID_* env
                vars for production, or ALLOW_DEV_LOGIN=true for local testing.
              </p>
            </div>
          </div>
        </AppShell>
      );
    }

    const users = await getTestUsers();

    return (
      <AppShell session={null}>
        <div className="container">
          <div className="card" style={{ marginTop: "3rem" }}>
            <h1>Sign in</h1>
            <p
              className="helptext"
              style={{
                background: "var(--cpl-amber-tint)",
                border: "1px solid var(--cpl-amber-border)",
                borderRadius: 4,
                padding: "0.6em 0.8em",
                color: "var(--cpl-ink)",
              }}
            >
              Local testing only — no password. This must never be enabled in a deployed
              production environment.
            </p>
            <form
              action={async (formData: FormData) => {
                "use server";
                const upn = formData.get("upn");
                await signIn("dev-login", {
                  upn: typeof upn === "string" ? upn : "",
                  redirectTo: "/",
                });
              }}
              style={{ marginTop: "1rem" }}
            >
              <label htmlFor="upn">Test user</label>
              <select name="upn" id="upn" style={{ marginBottom: "0.9rem" }}>
                {users.map((u) => (
                  <option key={u.upn} value={u.upn}>
                    {u.displayName} ({u.upn})
                  </option>
                ))}
              </select>
              <button type="submit" className="btn btn-primary">
                Sign in
              </button>
            </form>
          </div>
        </div>
      </AppShell>
    );
  }

  const canSubmitBriefs =
    session.accessRoles.includes("account_manager") ||
    session.accessRoles.includes("sales_coordinator");

  const recentBriefs = canSubmitBriefs ? await getRecentBriefsFor(session.userId) : [];

  return (
    <AppShell session={session}>
      <div className="container-wide">
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: "1.5rem",
          }}
        >
          <h1>Your briefs</h1>
          {canSubmitBriefs && (
            <a href="/briefs/new" className="btn btn-primary">
              New brief
            </a>
          )}
        </div>

        {!canSubmitBriefs && (
          <div className="card">
            <p style={{ margin: 0 }}>
              Signed in as <strong>{session.user?.name}</strong>. Your role (
              {session.accessRoles.join(", ") || "none"}) doesn&apos;t submit briefs
              directly —{" "}
              {(session.accessRoles.includes("auditor") ||
                session.accessRoles.includes("admin")) && (
                <>
                  use <a href="/verify">Verify a code</a> to look up any brief by its
                  Approval Code.
                </>
              )}
            </p>
          </div>
        )}

        {canSubmitBriefs && recentBriefs.length === 0 && (
          <div className="card">
            <p style={{ margin: 0 }}>
              No briefs submitted yet. <a href="/briefs/new">Submit your first brief</a>.
            </p>
          </div>
        )}

        {canSubmitBriefs && recentBriefs.length > 0 && (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--cpl-paper)" }}>
                  {["Customer", "Submitted", "Score", "Decision", "Approval Code"].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "0.7em 1em",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          color: "var(--cpl-ink-soft)",
                          borderBottom: "1px solid var(--cpl-border)",
                        }}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {recentBriefs.map((b) => (
                  <tr
                    key={b.briefId}
                    style={{ borderBottom: "1px solid var(--cpl-border)" }}
                  >
                    <td style={{ padding: "0.7em 1em" }}>{b.customerReference}</td>
                    <td style={{ padding: "0.7em 1em", color: "var(--cpl-ink-soft)" }}>
                      {new Date(b.submittedAt).toLocaleDateString("en-GB")}
                    </td>
                    <td
                      style={{ padding: "0.7em 1em", fontVariantNumeric: "tabular-nums" }}
                    >
                      {Number(b.score).toFixed(1)}
                    </td>
                    <td style={{ padding: "0.7em 1em" }}>
                      <StatusPill status={b.finalStatus} />
                    </td>
                    <td
                      style={{
                        padding: "0.7em 1em",
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.8125rem",
                      }}
                    >
                      {b.approvalCode ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
