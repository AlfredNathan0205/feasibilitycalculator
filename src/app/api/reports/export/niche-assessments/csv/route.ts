import { auth } from "../../../../../../auth.js";
import { hasAccessRole } from "../../../../../../auth/authz.js";
import { getNicheAssessmentExportRows } from "../../../../../../services/reporting.js";
import { getDb } from "../../../../../../lib/db.js";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export async function GET() {
  const session = await auth();
  if (!session) return new Response("Not signed in", { status: 401 });
  if (!hasAccessRole(session, "admin") && !hasAccessRole(session, "auditor")) {
    return new Response("Requires the Admin or Auditor role", { status: 403 });
  }
  const rows = await getNicheAssessmentExportRows(getDb());
  const headers = rows.length > 0 ? Object.keys(rows[0]!) : [];
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      headers.map((h) => csvEscape((r as Record<string, unknown>)[h])).join(","),
    ),
  ].join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="niche-assessments-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
