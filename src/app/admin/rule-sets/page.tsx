import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { auth } from "../../../auth.js";
import * as schema from "../../../db/schema.js";
import { hasAccessRole } from "../../../auth/authz.js";
import { listRuleSets } from "../../../services/rule-set-editor.js";
import { AppShell } from "../../components/app-shell.js";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  return drizzle(postgres(databaseUrl), { schema });
}

const STATUS_CLASS: Record<string, string> = {
  published: "status-approved",
  draft: "status-pending",
  superseded: "status-declined",
};

export default async function RuleSetsListPage() {
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
  if (!hasAccessRole(session, "admin")) {
    return (
      <AppShell session={session}>
        <div className="container">
          <div className="card" style={{ marginTop: "3rem" }}>
            <p style={{ margin: 0 }}>Requires the Admin role.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const db = getDb();
  const ruleSets = await listRuleSets(db);

  async function createDraft() {
    "use server";
    const session = await auth();
    if (!session || !hasAccessRole(session, "admin")) return;
    const { createDraftRuleSet } = await import("../../../services/rule-set-editor.js");
    const { redirect } = await import("next/navigation");
    const draft = await createDraftRuleSet(getDb(), { createdBy: session.userId });
    redirect(`/admin/rule-sets/${draft.id}`);
  }

  return (
    <AppShell session={session}>
      <div className="container-wide">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: "1.5rem",
          }}
        >
          <h1>Rule sets</h1>
          <form action={createDraft}>
            <button type="submit" className="btn btn-primary">
              New draft
            </button>
          </form>
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--cpl-paper)" }}>
                {["Version", "Status", "Created", "Published"].map((h) => (
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
                ))}
              </tr>
            </thead>
            <tbody>
              {ruleSets.map((rs) => (
                <tr key={rs.id} style={{ borderBottom: "1px solid var(--cpl-border)" }}>
                  <td style={{ padding: "0.7em 1em" }}>
                    <a href={`/admin/rule-sets/${rs.id}`}>v{rs.version}</a>
                  </td>
                  <td style={{ padding: "0.7em 1em" }}>
                    <span className={`status-pill ${STATUS_CLASS[rs.status]}`}>
                      {rs.status}
                    </span>
                  </td>
                  <td style={{ padding: "0.7em 1em", color: "var(--cpl-ink-soft)" }}>
                    {new Date(rs.createdAt).toLocaleDateString("en-GB")}
                  </td>
                  <td style={{ padding: "0.7em 1em", color: "var(--cpl-ink-soft)" }}>
                    {rs.publishedAt
                      ? new Date(rs.publishedAt).toLocaleDateString("en-GB")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
