import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { auth } from "../../../auth.js";
import * as schema from "../../../db/schema.js";
import { hasAccessRole } from "../../../auth/authz.js";
import { verifyApprovalCode } from "../../../engine/approval-code.js";
import { AppShell } from "../../components/app-shell.js";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  return drizzle(postgres(databaseUrl), { schema });
}

const DECISION_LABEL: Record<string, string> = {
  auto_approved: "Auto-Approved",
  pending: "Pending Approval",
  declined: "Declined",
};

const STATUS_CLASS: Record<string, string> = {
  approved: "status-approved",
  declined: "status-declined",
  pending: "status-pending",
};

/**
 * §6: "Given a code it returns the brief, its score breakdown, its
 * decision, the rule set version that produced it, and the full approval
 * history. This is the audit entry point and must be available to Auditor
 * and Admin without needing to know the submitter."
 *
 * Deliberately does NOT check whether the signed-in user is the brief's
 * submitter — Auditor/Admin access is role-based, not ownership-based.
 */
export default async function VerifyPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const session = await auth();

  if (!session) {
    return (
      <AppShell session={null}>
        <div className="container">
          <p style={{ marginTop: "3rem" }}>Not signed in.</p>
        </div>
      </AppShell>
    );
  }
  if (!hasAccessRole(session, "auditor") && !hasAccessRole(session, "admin")) {
    return (
      <AppShell session={session}>
        <div className="container">
          <div className="card" style={{ marginTop: "3rem" }}>
            <p style={{ margin: 0 }}>Requires the Auditor or Admin role.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const verification = verifyApprovalCode(decodeURIComponent(code));

  if (!verification.valid) {
    return (
      <AppShell session={session}>
        <div className="container">
          <h1>Verify Approval Code</h1>
          <div className="card">
            <p style={{ margin: 0 }}>
              <code style={{ fontFamily: "var(--font-mono)" }}>
                {verification.formatted ?? code}
              </code>{" "}
              is not a valid code — structurally invalid, or the check character
              doesn&apos;t match (it may have been mistyped).
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  const db = getDb();
  const [decision] = await db
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.approvalCode, verification.formatted!));

  if (!decision) {
    return (
      <AppShell session={session}>
        <div className="container">
          <h1>Verify Approval Code</h1>
          <div className="card">
            <p style={{ margin: 0 }}>
              <code style={{ fontFamily: "var(--font-mono)" }}>
                {verification.formatted}
              </code>{" "}
              is a structurally valid code, but no brief with this code exists.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  const [brief] = await db
    .select()
    .from(schema.briefs)
    .where(eq(schema.briefs.id, decision.briefId));

  const [ruleSet] = await db
    .select({ version: schema.ruleSets.version })
    .from(schema.ruleSets)
    .where(eq(schema.ruleSets.id, decision.ruleSetId));

  const requirements = await db
    .select()
    .from(schema.approvalRequirements)
    .where(eq(schema.approvalRequirements.decisionId, decision.id));

  const breakdown = decision.scoreBreakdown as Record<string, number>;

  return (
    <AppShell session={session}>
      <div className="container-wide">
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <h1 style={{ marginBottom: 0 }}>
            <code style={{ fontFamily: "var(--font-mono)" }}>
              {verification.formatted}
            </code>
          </h1>
          <span className="helptext">rule set v{ruleSet?.version}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
          <div className="card">
            <h2>Brief</h2>
            <dl
              style={{
                margin: 0,
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: "0.4em 1em",
                fontSize: "0.875rem",
              }}
            >
              <dt style={{ color: "var(--cpl-ink-soft)" }}>Customer</dt>
              <dd style={{ margin: 0 }}>{brief?.customerReference}</dd>
              <dt style={{ color: "var(--cpl-ink-soft)" }}>Tier</dt>
              <dd style={{ margin: 0 }}>{brief?.tier}</dd>
              <dt style={{ color: "var(--cpl-ink-soft)" }}>Value potential</dt>
              <dd style={{ margin: 0 }}>
                £{Number(brief?.valuePotentialGbp).toLocaleString("en-GB")}
              </dd>
              <dt style={{ color: "var(--cpl-ink-soft)" }}>New/Rework</dt>
              <dd style={{ margin: 0 }}>{brief?.newRework}</dd>
              <dt style={{ color: "var(--cpl-ink-soft)" }}>Brief type</dt>
              <dd style={{ margin: 0 }}>{brief?.briefType}</dd>
              <dt style={{ color: "var(--cpl-ink-soft)" }}>Creative approach</dt>
              <dd style={{ margin: 0 }}>{brief?.creativeApproach}</dd>
              <dt style={{ color: "var(--cpl-ink-soft)" }}>Deadline</dt>
              <dd style={{ margin: 0 }}>{brief?.deadline}</dd>
              <dt style={{ color: "var(--cpl-ink-soft)" }}>Submitted</dt>
              <dd style={{ margin: 0 }}>
                {brief?.submittedAt
                  ? new Date(brief.submittedAt).toLocaleString("en-GB")
                  : "—"}
              </dd>
            </dl>
          </div>

          <div className="card">
            <h2>Decision</h2>
            <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
              <span className={`status-pill ${STATUS_CLASS[decision.finalStatus]}`}>
                {decision.finalStatus === "approved"
                  ? "Approved"
                  : decision.finalStatus === "declined"
                    ? "Declined"
                    : "Pending"}
              </span>
              <span className="helptext">
                commercial: {DECISION_LABEL[decision.commercialDecision]}
              </span>
            </div>
            <table
              style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}
            >
              <tbody>
                {Object.entries(breakdown).map(([k, v]) => (
                  <tr key={k} style={{ borderTop: "1px solid var(--cpl-border)" }}>
                    <td style={{ padding: "0.35em 0", color: "var(--cpl-ink-soft)" }}>
                      {k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
                    </td>
                    <td
                      style={{
                        padding: "0.35em 0",
                        textAlign: "right",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {Number(v).toFixed(1)}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--cpl-ink)" }}>
                  <td style={{ padding: "0.4em 0", fontWeight: 700 }}>Total</td>
                  <td
                    style={{
                      padding: "0.4em 0",
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                    }}
                  >
                    {Number(decision.computedScore).toFixed(1)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ marginTop: "1.25rem" }}>
          <h2>Approval history</h2>
          {requirements.length === 0 ? (
            <p className="helptext" style={{ margin: 0 }}>
              No approval requirements were raised for this brief.
            </p>
          ) : (
            <table
              style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}
            >
              <thead>
                <tr>
                  {["Requirement", "Role", "State", "Decided"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "0.5em 0",
                        color: "var(--cpl-ink-soft)",
                        fontWeight: 600,
                        borderBottom: "1px solid var(--cpl-border)",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {requirements.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--cpl-border)" }}>
                    <td style={{ padding: "0.5em 0" }}>
                      {r.requirementType.replace(/_/g, " ")}
                    </td>
                    <td style={{ padding: "0.5em 0" }}>
                      {r.requiredRoleKey.replace(/_/g, " ")}
                    </td>
                    <td style={{ padding: "0.5em 0" }}>{r.state}</td>
                    <td style={{ padding: "0.5em 0", color: "var(--cpl-ink-soft)" }}>
                      {r.decidedAt ? new Date(r.decidedAt).toLocaleString("en-GB") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}
