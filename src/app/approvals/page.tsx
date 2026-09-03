import { revalidatePath } from "next/cache";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { auth } from "../../auth.js";
import * as schema from "../../db/schema.js";
import {
  hasAccessRole,
  requireCanDecideRequirement,
  AuthorizationError,
} from "../../auth/authz.js";
import { decideRequirement, listPendingRequirementsForRoles } from "../../services/decide-requirement.js";
import { AppShell } from "../components/app-shell.js";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  return drizzle(postgres(databaseUrl), { schema });
}

const REQUIREMENT_LABELS: Record<string, string> = {
  short_deadline: "Short deadline",
  creative_creation: "Creative approach (Creation)",
  creative_starting_point: "Creative approach (Starting Point)",
  marketing_resource: "Marketing resource",
  ppd_resource: "PPD resource",
  gcms_resource: "GCMS / analytical resource",
};

export default async function ApprovalsPage() {
  const session = await auth();

  if (!session) {
    return (
      <AppShell session={null}>
        <div className="container">
          <p style={{ marginTop: "3rem" }}><a href="/">Sign in</a> first.</p>
        </div>
      </AppShell>
    );
  }

  if (!hasAccessRole(session, "approver")) {
    return (
      <AppShell session={session}>
        <div className="container">
          <div className="card" style={{ marginTop: "3rem" }}>
            <p style={{ margin: 0 }}>Requires the Approver role.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const db = getDb();
  const items = await listPendingRequirementsForRoles(
    db,
    session.approvalAuthorityRoles,
  );

  async function decide(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session) return;

    const requirementId = String(formData.get("requirementId"));
    const decision = formData.get("decision") === "reject" ? "reject" : "approve";
    const comment = String(formData.get("comment") ?? "");

    const db = getDb();
    const [requirement] = await db
      .select()
      .from(schema.approvalRequirements)
      .where(eq(schema.approvalRequirements.id, requirementId));
    if (!requirement) return;
    const [brief] = await db
      .select()
      .from(schema.briefs)
      .where(eq(schema.briefs.id, requirement.briefId));
    if (!brief) return;

    try {
      requireCanDecideRequirement(
        session,
        { submittedBy: brief.submittedBy, onBehalfOf: brief.onBehalfOf },
        { requiredRoleKey: requirement.requiredRoleKey },
      );
    } catch (err) {
      if (err instanceof AuthorizationError) return; // silently no-op; the button shouldn't have been shown
      throw err;
    }

    await decideRequirement(db, {
      requirementId,
      decidedBy: session.userId,
      decision,
      comment: comment || null,
    });
    revalidatePath("/approvals");
  }

  return (
    <AppShell session={session}>
      <div className="container-wide">
        <h1>Your approvals</h1>
        <p className="helptext">
          Requirements assigned to: {session.approvalAuthorityRoles.join(", ") || "(none)"}
        </p>

        {items.length === 0 ? (
          <div className="card">
            <p style={{ margin: 0 }}>Nothing pending.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "1rem" }}>
            {items.map((item) => (
              <div key={item.requirementId} className="card">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: "0.75rem",
                  }}
                >
                  <div>
                    <h3 style={{ marginBottom: "0.2em" }}>
                      {item.customerReference} — {item.tier}, £
                      {Number(item.valuePotentialGbp).toLocaleString("en-GB")}
                    </h3>
                    <span className="helptext">
                      {REQUIREMENT_LABELS[item.requirementTypeKind] ?? item.requirementTypeKind}{" "}
                      · score {Number(item.score).toFixed(1)} ·{" "}
                      {item.commercialDecision === "auto_approved"
                        ? "commercially Auto-Approved"
                        : item.commercialDecision === "declined"
                          ? "commercially Declined"
                          : "commercially Pending"}
                    </span>
                  </div>
                </div>

                <form action={decide} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
                  <input type="hidden" name="requirementId" value={item.requirementId} />
                  <textarea
                    name="comment"
                    placeholder="Comment (required to reject)"
                    rows={1}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="submit"
                    name="decision"
                    value="approve"
                    className="btn btn-primary"
                  >
                    Approve
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="reject"
                    className="btn btn-secondary"
                    style={{ borderColor: "var(--cpl-red)", color: "var(--cpl-red)" }}
                  >
                    Reject
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
