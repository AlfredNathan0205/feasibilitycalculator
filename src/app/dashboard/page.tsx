import { auth } from "../../auth.js";
import { hasAccessRole } from "../../auth/authz.js";
import { getDashboardSummary } from "../../services/reporting.js";
import { AppShell } from "../components/app-shell.js";
import { DashboardPanels } from "./panels.js";
import { getDb } from "../../lib/db.js";

export default async function DashboardPage() {
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
  if (!hasAccessRole(session, "admin") && !hasAccessRole(session, "auditor")) {
    return (
      <AppShell session={session}>
        <div className="container">
          <div className="card" style={{ marginTop: "3rem" }}>
            <p style={{ margin: 0 }}>Requires the Admin or Auditor role.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const db = getDb();
  const summary = await getDashboardSummary(db);

  return (
    <AppShell session={session}>
      <div className="container-wide">
        <div className="eyebrow">DASHBOARD</div>
        <div className="page-header">
          <h1>Overview</h1>
          <div className="page-header-actions">
            <a className="btn btn-secondary" href="/api/reports/export/csv">
              Export CSV
            </a>
            <a className="btn btn-secondary" href="/api/reports/export/xlsx">
              Export XLSX
            </a>
          </div>
        </div>
        <DashboardPanels summary={summary} />
      </div>
    </AppShell>
  );
}
