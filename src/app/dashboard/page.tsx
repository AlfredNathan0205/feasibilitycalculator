import { auth } from "../../auth.js";
import { canViewDashboard, hasAccessRole } from "../../auth/authz.js";
import { getDashboardSummary } from "../../services/reporting.js";
import { AppShell } from "../components/app-shell.js";
import { DashboardPanels } from "./panels.js";
import { getDb } from "../../lib/db.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ am?: string }>;
}) {
  const session = await auth();
  console.log("[dashboard] auth done");

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
  if (!canViewDashboard(session)) {
    return (
      <AppShell session={session}>
        <div className="container">
          <div className="card" style={{ marginTop: "3rem" }}>
            <p style={{ margin: 0 }}>
              Requires the Admin, Auditor or General Manager role.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  const { am } = await searchParams;
  const accountManagerId = am && UUID.test(am) ? am : undefined;
  const db = getDb();
  const summary = await getDashboardSummary(db, { accountManagerId });
  const selected = summary.accountManagers.find((a) => a.id === accountManagerId);
  const canExport = hasAccessRole(session, "admin") || hasAccessRole(session, "auditor");
  const exportQuery = accountManagerId ? `?am=${accountManagerId}` : "";

  return (
    <AppShell session={session}>
      <div className="container-wide">
        <div className="eyebrow">DASHBOARD</div>
        <div className="page-header">
          <h1>Overview</h1>
          {canExport && (
            <div className="page-header-actions">
              <a
                className="btn btn-secondary"
                href={`/api/reports/export/csv${exportQuery}`}
              >
                Export CSV
              </a>
              <a
                className="btn btn-secondary"
                href={`/api/reports/export/xlsx${exportQuery}`}
              >
                Export XLSX
              </a>
              <a
                className="btn btn-secondary"
                href="/api/reports/export/niche-assessments/csv"
              >
                Niche assessments CSV
              </a>
              <a
                className="btn btn-secondary"
                href="/api/reports/export/niche-assessments/xlsx"
              >
                Niche assessments XLSX
              </a>
            </div>
          )}
        </div>
        <form method="get" className="card" style={{ marginBottom: "1rem" }}>
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              alignItems: "end",
            }}
          >
            <div>
              <label htmlFor="am">Account Manager</label>
              <select id="am" name="am" defaultValue={accountManagerId ?? ""}>
                <option value="">Everyone</option>
                {summary.accountManagers.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary">
              Apply
            </button>
            {selected && (
              <a href="/dashboard" className="btn btn-secondary">
                Show everyone
              </a>
            )}
          </div>
          {selected && (
            <p className="helptext" style={{ margin: "0.6rem 0 0" }}>
              Showing briefs for <strong>{selected.name}</strong>. Approval rate and
              time-to-decision by role always shows the whole team.
            </p>
          )}
        </form>
        <DashboardPanels summary={summary} filtered={Boolean(selected)} />
      </div>
    </AppShell>
  );
}
