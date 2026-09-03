import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { auth } from "../../../auth.js";
import * as schema from "../../../db/schema.js";
import { hasAccessRole } from "../../../auth/authz.js";
import { verifyApprovalCode } from "../../../engine/approval-code.js";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  return drizzle(postgres(databaseUrl), { schema });
}

/**
 * §6: "Given a code it returns the brief, its score breakdown, its
 * decision, the rule set version that produced it, and the full approval
 * history. This is the audit entry point and must be available to Auditor
 * and Admin without needing to know the submitter."
 *
 * Deliberately does NOT check whether the signed-in user is the brief's
 * submitter — Auditor/Admin access is role-based, not ownership-based, by
 * design (that's the whole point of an audit entry point).
 */
export default async function VerifyPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const session = await auth();

  if (!session) {
    return <main><p>Not signed in.</p></main>;
  }
  if (!hasAccessRole(session, "auditor") && !hasAccessRole(session, "admin")) {
    return (
      <main>
        <p>Requires the Auditor or Admin role.</p>
      </main>
    );
  }

  const verification = verifyApprovalCode(decodeURIComponent(code));
  if (!verification.valid) {
    return (
      <main>
        <h1>Verify Approval Code</h1>
        <p>
          <strong>{verification.formatted ?? code}</strong> is not a valid
          code (structurally invalid, or the check character doesn't
          match — it may have been mistyped).
        </p>
      </main>
    );
  }

  const db = getDb();
  const [decision] = await db
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.approvalCode, verification.formatted!));

  if (!decision) {
    return (
      <main>
        <h1>Verify Approval Code</h1>
        <p>
          <strong>{verification.formatted}</strong> is a structurally valid
          code, but no brief with this code exists.
        </p>
      </main>
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

  return (
    <main>
      <h1>Verify Approval Code</h1>
      <p>
        <strong>{verification.formatted}</strong> — rule set v
        {ruleSet?.version}
      </p>
      <h2>Brief</h2>
      <pre>{JSON.stringify(brief, null, 2)}</pre>
      <h2>Decision</h2>
      <pre>{JSON.stringify(decision, null, 2)}</pre>
      <h2>Approval history</h2>
      <pre>{JSON.stringify(requirements, null, 2)}</pre>
    </main>
  );
}
