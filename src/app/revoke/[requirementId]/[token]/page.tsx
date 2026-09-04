import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../../../../db/schema.js";
import {
  revokeRequirement,
  ValidationError,
  NotFoundError,
} from "../../../../services/decide-requirement.js";
import { AppShell } from "../../../components/app-shell.js";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  return drizzle(postgres(databaseUrl), { schema });
}

/**
 * §5 Stage C revoke link. Deliberately NOT behind auth — the security
 * model is possession of the signed, single-use token in the URL itself
 * (the nominated manager clicks an emailed link; they don't need to be
 * signed in to this app at all). See engine/revoke-token.ts.
 */
export default async function RevokePage({
  params,
  searchParams,
}: {
  params: Promise<{ requirementId: string; token: string }>;
  searchParams: Promise<{ confirmed?: string }>;
}) {
  const { requirementId, token } = await params;
  const { confirmed } = await searchParams;
  const db = getDb();

  if (confirmed === "1") {
    // JSX is constructed AFTER the try/catch resolves, not inside it —
    // React doesn't synchronously render JSX at the point it's written,
    // so constructing it inside a try block doesn't actually catch
    // rendering errors the way it looks like it would (caught by
    // react-hooks/error-boundaries).
    let outcome:
      { kind: "revoked"; finalStatus: string } | { kind: "error"; message: string };
    try {
      const result = await revokeRequirement(db, {
        requirementId,
        rawToken: decodeURIComponent(token),
      });
      outcome = { kind: "revoked", finalStatus: result.finalStatus };
    } catch (err) {
      const message =
        err instanceof ValidationError || err instanceof NotFoundError
          ? err.message
          : "Something went wrong revoking this pre-approval.";
      outcome = { kind: "error", message };
    }

    if (outcome.kind === "revoked") {
      return (
        <AppShell session={null}>
          <div className="container">
            <div className="card" style={{ marginTop: "3rem" }}>
              <h1>Revoked</h1>
              <p style={{ margin: 0 }}>
                This pre-approval has been revoked. The brief has returned to pending (
                {outcome.finalStatus}) and its Approval Code, if one had been issued, has
                been withdrawn. The submitter has been notified.
              </p>
            </div>
          </div>
        </AppShell>
      );
    }
    return (
      <AppShell session={null}>
        <div className="container">
          <div className="card" style={{ marginTop: "3rem" }}>
            <h1>Unable to revoke</h1>
            <p style={{ margin: 0 }}>{outcome.message}</p>
          </div>
        </div>
      </AppShell>
    );
  }

  // Look up enough detail for a meaningful confirmation prompt without
  // consuming the token — only the "confirmed=1" POST-equivalent below
  // actually revokes it.
  const [requirement] = await db
    .select()
    .from(schema.approvalRequirements)
    .where(eq(schema.approvalRequirements.id, requirementId));

  if (!requirement || requirement.state !== "pre_approved") {
    return (
      <AppShell session={null}>
        <div className="container">
          <div className="card" style={{ marginTop: "3rem" }}>
            <h1>Nothing to revoke</h1>
            <p style={{ margin: 0 }}>
              This link is no longer valid — the pre-approval it refers to has already
              been decided, revoked, or doesn&apos;t exist.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  const [brief] = await db
    .select()
    .from(schema.briefs)
    .where(eq(schema.briefs.id, requirement.briefId));

  return (
    <AppShell session={null}>
      <div className="container">
        <div className="card" style={{ marginTop: "3rem" }}>
          <h1>Revoke this pre-approval?</h1>
          <p>
            You pre-approved{" "}
            <strong>{requirement.requirementType.replace(/_/g, " ")}</strong> for{" "}
            <strong>{brief?.customerReference}</strong>. Revoking will return this
            requirement to pending and withdraw any Approval Code already issued for this
            brief. This cannot be undone, and this link can only be used once.
          </p>
          <form
            action={async () => {
              "use server";
              const { redirect } = await import("next/navigation");
              redirect(
                `/revoke/${requirementId}/${encodeURIComponent(token)}?confirmed=1`,
              );
            }}
          >
            <button
              type="submit"
              className="btn btn-primary"
              style={{ background: "var(--cpl-red)", borderColor: "var(--cpl-red)" }}
            >
              Yes, revoke this pre-approval
            </button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
