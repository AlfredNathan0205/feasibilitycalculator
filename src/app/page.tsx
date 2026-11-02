import { eq, desc } from "drizzle-orm";
import { auth, signIn } from "../auth.js";
import * as schema from "../db/schema.js";
import { AppShell } from "./components/app-shell.js";
import { StatusPill } from "./components/status-pill.js";
import Image from "next/image";
import { getDb } from "../lib/db.js";

const devLoginEnabled = process.env.ALLOW_DEV_LOGIN === "true";

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

export default async function Home() {
  const session = await auth();

  if (!session) {
    if (!devLoginEnabled) {
      return (
        <div className="auth-screen">
          <div className="auth-brand-panel">
            <div className="auth-brand-eyebrow">CPL AROMAS</div>
            <div className="auth-brand-headline">Project Feasibility Calculator</div>
            <p>Score, route, and audit customer fragrance briefs.</p>
          </div>
          <div className="auth-form-panel">
            <div className="auth-card">
              <div className="auth-logo-badge">
                <Image
                  src="/cpl-logo-muted.png"
                  alt="CPL Aromas"
                  width={44}
                  height={44}
                  style={{ borderRadius: 8 }}
                />
              </div>
              <h1>Welcome</h1>
              <p className="auth-subtitle">
                No sign-in method is configured. Set the AUTH_MICROSOFT_ENTRA_ID_* env
                vars for production, or ALLOW_DEV_LOGIN=true for local testing.
              </p>
            </div>
          </div>
        </div>
      );
    }

    const users = await getTestUsers();

    return (
      <div className="auth-screen">
        <div className="auth-brand-panel">
          <div className="auth-brand-eyebrow">CPL AROMAS</div>
          <div className="auth-brand-headline">Project Feasibility Calculator</div>
          <p>Score, route, and audit customer fragrance briefs.</p>
        </div>
        <div className="auth-form-panel">
          <div className="auth-card">
            <div className="auth-logo-badge">
              <Image
                src="/cpl-logo-muted.png"
                alt="CPL Aromas"
                width={44}
                height={44}
                style={{ borderRadius: 8 }}
              />
            </div>
            <h1>Welcome</h1>
            <p className="auth-subtitle">Sign in to continue</p>
            <p
              style={{
                background: "#fbf1e6",
                border: "1px solid #e8cba3",
                borderRadius: 4,
                padding: "0.6em 0.8em",
                color: "var(--cpl-ink)",
                fontSize: "0.8125rem",
                marginBottom: "1rem",
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
            >
              <label htmlFor="upn">Test user</label>
              <select name="upn" id="upn" style={{ marginBottom: "0.9rem" }}>
                {users.map((u) => (
                  <option key={u.upn} value={u.upn}>
                    {u.displayName} ({u.upn})
                  </option>
                ))}
              </select>
              <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
                Sign in
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const canSubmitBriefs =
    session.accessRoles.includes("account_manager") ||
    session.accessRoles.includes("sales_coordinator");

  const recentBriefs = canSubmitBriefs ? await getRecentBriefsFor(session.userId) : [];

  return (
    <AppShell session={session}>
      <div className="container-wide">
        <div className="eyebrow">
          {session.accessRoles.includes("account_manager")
            ? "ACCOUNT MANAGER"
            : session.accessRoles.includes("sales_coordinator")
              ? "SALES COORDINATOR"
              : (session.accessRoles[0]?.replace(/_/g, " ").toUpperCase() ?? "USER")}
        </div>
        <div className="page-header">
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
              directly. Open <a href="/briefs">Briefs</a> to search and review them
              {(session.accessRoles.includes("auditor") ||
                session.accessRoles.includes("admin")) && (
                <>
                  , or use <a href="/verify">Verify a code</a> to look up a brief by its
                  Approval Code
                </>
              )}
              .
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
            <table className="data-table data-table-flush">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Submitted</th>
                  <th className="num">Score</th>
                  <th>Decision</th>
                  <th>Approval Code</th>
                </tr>
              </thead>
              <tbody>
                {recentBriefs.map((b) => (
                  <tr key={b.briefId}>
                    <td style={{ fontWeight: 500 }}>
                      <a href={`/briefs/${b.briefId}`}>{b.customerReference}</a>
                    </td>
                    <td style={{ color: "var(--cpl-ink-soft)" }}>
                      {new Date(b.submittedAt).toLocaleDateString("en-GB")}
                    </td>
                    <td className="num">{Number(b.score).toFixed(1)}</td>
                    <td>
                      <StatusPill status={b.finalStatus} />
                    </td>
                    <td
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.8125rem",
                        color: "var(--cpl-ink-soft)",
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
