import { canManageNicheFrameworks } from "../../../auth/authz.js";
import { listFrameworks } from "../../../services/niche-framework-editor.js";
import { AppShell } from "../../components/app-shell.js";
import { getDb } from "../../../lib/db.js";
import { Notice, fmtDate, currentSession } from "../../niche/gate.js";
import { createFrameworkDraftAction } from "./actions.js";
import type { NicheFrameworkPayload } from "../../../engine/niche-assessment.js";

const STATUS_CLASS: Record<string, string> = {
  published: "status-approved",
  draft: "status-pending",
  superseded: "status-declined",
};

export default async function NicheFrameworksPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const session = await currentSession();
  if (!session || !canManageNicheFrameworks(session)) {
    return (
      <AppShell session={session}>
        <div className="container">
          <div className="card" style={{ marginTop: "3rem" }}>
            <p style={{ margin: 0 }}>
              {session ? "Requires the Admin role." : "Sign in first."}
            </p>
          </div>
        </div>
      </AppShell>
    );
  }
  const { ok, error } = await searchParams;
  const frameworks = await listFrameworks(getDb());
  const hasDraft = frameworks.some((f) => f.status === "draft");
  return (
    <AppShell session={session}>
      <div className="container-wide">
        <div className="eyebrow">ADMIN</div>
        <div className="page-header">
          <h1>Niche frameworks</h1>
          {!hasDraft && (
            <form action={createFrameworkDraftAction}>
              <button type="submit" className="btn btn-primary">
                New draft
              </button>
            </form>
          )}
        </div>
        <Notice ok={ok} error={error} />
        <div className="card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Criteria</th>
                <th>Published</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {frameworks.map((f) => {
                const p = f.payload as NicheFrameworkPayload;
                return (
                  <tr key={f.id}>
                    <td>v{f.version}</td>
                    <td>
                      <span className={`status-pill ${STATUS_CLASS[f.status] ?? ""}`}>
                        {f.status}
                      </span>
                    </td>
                    <td>{p.sections.reduce((n, s) => n + s.criteria.length, 0)}</td>
                    <td>{fmtDate(f.publishedAt)}</td>
                    <td>{f.sourceNote ?? "—"}</td>
                    <td>
                      <a href={`/admin/niche-frameworks/${f.id}`}>
                        {f.status === "draft" ? "Edit" : "View"}
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
