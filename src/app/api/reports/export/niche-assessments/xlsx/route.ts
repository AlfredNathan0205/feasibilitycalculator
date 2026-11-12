import * as XLSX from "xlsx";
import { auth } from "../../../../../../auth.js";
import { hasAccessRole } from "../../../../../../auth/authz.js";
import { getNicheAssessmentExportRows } from "../../../../../../services/reporting.js";
import { getDb } from "../../../../../../lib/db.js";

export async function GET() {
  const session = await auth();
  if (!session) return new Response("Not signed in", { status: 401 });
  if (!hasAccessRole(session, "admin") && !hasAccessRole(session, "auditor")) {
    return new Response("Requires the Admin or Auditor role", { status: 403 });
  }
  const rows = await getNicheAssessmentExportRows(getDb());
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows),
    "Niche assessments",
  );
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="niche-assessments-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
