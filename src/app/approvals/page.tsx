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
import {
  decideRequirement,
  decideRequirementsBulk,
  listPendingRequirementsForRoles,
} from "../../services/decide-requirement.js";
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

/** A stable, DOM-safe id for the bulk-approve <form> that a given
 * requirement type's checkboxes are associated with via the HTML `form`
 * attribute — this is what keeps a bulk action scoped to "the same
 * requirement type" (§9) by construction, rather than by a runtime check:
 * a checkbox can only ever submit into the one form for its own type. */
function bulkFormId(requirementTypeKind: string) {
  return `bulk-approve-${requirementTypeKind}`;
}

export default async function ApprovalsPage() {
  const session = await auth();

  if (!session) {
    return (
      <AppShell session={null}>
        <div className="container">
          <p style={{ marginTop: "3rem" }}>
            <a href="/">Sign in</a> first.
          </p>
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
  const items = await listPendingRequirementsForRoles(db, session.approvalAuthorityRoles);

  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const group = groups.get(item.requirementTypeKind);
    if (group) group.push(item);
    else groups.set(item.requirementTypeKind, [item]);
  }

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

  /** §9 bulk-approve. Approve only, deliberately — rejection requires a
   * mandatory per-item comment, which doesn't have a sensible one-size-
   * fits-all bulk equivalent. Each id is independently re-authorized here
   * (never trust which checkboxes the client happened to render), and one
   * item failing (already decided, wrong role, etc.) doesn't block the
   * rest of the batch — see decideRequirementsBulk's docstring. */
  async function bulkApprove(formData: FormData) {
    "use server";
    const session = await auth();
    if (!session) return;

    const requirementIds = formData.getAll("requirementIds").map(String);
    if (requirementIds.length === 0) return;

    const db = getDb();
    const authorizedIds: string[] = [];
    for (const requirementId of requirementIds) {
      const [requirement] = await db
        .select()
        .from(schema.approvalRequirements)
        .where(eq(schema.approvalRequirements.id, requirementId));
      if (!requirement) continue;
      const [brief] = await db
        .select()
        .from(schema.briefs)
        .where(eq(schema.briefs.id, requirement.briefId));
      if (!brief) continue;

      try {
        requireCanDecideRequirement(
          session,
          { submittedBy: brief.submittedBy, onBehalfOf: brief.onBehalfOf },
          { requiredRoleKey: requirement.requiredRoleKey },
        );
        authorizedIds.push(requirementId);
      } catch (err) {
        if (!(err instanceof AuthorizationError)) throw err;
        // silently skipped, same convention as decide() above — the
        // checkbox shouldn't have been shown for something unauthorized
      }
    }

    if (authorizedIds.length > 0) {
      await decideRequirementsBulk(db, {
        requirementIds: authorizedIds,
        decidedBy: session.userId,
      });
      revalidatePath("/approvals");
    }
  }

  return (
    <AppShell session={session}>
      <div className="container-wide">
        <div className="page-header">
          <div>
            <h1 style={{ marginBottom: "0.2em" }}>Your approvals</h1>
            <p className="helptext" style={{ margin: 0 }}>
              Requirements assigned to:{" "}
              {session.approvalAuthorityRoles.join(", ") || "(none)"}
            </p>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="card">
            <p style={{ margin: 0 }}>Nothing pending.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "1.75rem" }}>
            {Array.from(groups.entries()).map(([requirementTypeKind, groupItems]) => {
              const formId = bulkFormId(requirementTypeKind);
              return (
                <div key={requirementTypeKind}>
                  <form id={formId} action={bulkApprove} />
                  <div className="page-header" style={{ marginBottom: "0.75rem" }}>
                    <h2 style={{ margin: 0 }}>
                      {REQUIREMENT_LABELS[requirementTypeKind] ?? requirementTypeKind}{" "}
                      <span className="helptext" style={{ fontWeight: 400 }}>
                        ({groupItems.length} pending)
                      </span>
                    </h2>
                    {groupItems.length > 1 && (
                      <button type="submit" form={formId} className="btn btn-primary">
                        Approve selected
                      </button>
                    )}
                  </div>

                  <div style={{ display: "grid", gap: "1rem" }}>
                    {groupItems.map((item) => (
                      <div key={item.requirementId} className="card ticket">
                        <div className="ticket-header">
                          <div style={{ display: "flex", gap: "0.75rem" }}>
                            {groupItems.length > 1 && (
                              <input
                                type="checkbox"
                                form={formId}
                                name="requirementIds"
                                value={item.requirementId}
                                aria-label={`Select ${item.customerReference} for bulk approval`}
                                style={{ marginTop: "0.2em" }}
                              />
                            )}
                            <div>
                              <div className="ticket-title">
                                {item.customerReference} — {item.tier}, £
                                {Number(item.valuePotentialGbp).toLocaleString("en-GB")}
                              </div>
                              <span className="ticket-meta">
                                score{" "}
                                <span className="num">
                                  {Number(item.score).toFixed(1)}
                                </span>{" "}
                                ·{" "}
                                {item.commercialDecision === "auto_approved"
                                  ? "commercially Auto-Approved"
                                  : item.commercialDecision === "declined"
                                    ? "commercially Declined"
                                    : "commercially Pending"}
                              </span>
                            </div>
                          </div>
                        </div>

                        <form
                          action={decide}
                          style={{
                            display: "flex",
                            gap: "0.6rem",
                            alignItems: "flex-start",
                          }}
                        >
                          <input
                            type="hidden"
                            name="requirementId"
                            value={item.requirementId}
                          />
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
                            style={{
                              borderColor: "var(--cpl-red)",
                              color: "var(--cpl-red)",
                            }}
                          >
                            Reject
                          </button>
                        </form>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
