import * as XLSX from "xlsx";
import { auth } from "../../../../../auth.js";
import { hasAccessRole } from "../../../../../auth/authz.js";
import { getExportableBriefRows } from "../../../../../services/reporting.js";
import { getDb } from "../../../../../lib/db.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const session = await auth();
  if (!session) {
    return new Response("Not signed in", { status: 401 });
  }
  if (!hasAccessRole(session, "admin") && !hasAccessRole(session, "auditor")) {
    return new Response("Requires the Admin or Auditor role", { status: 403 });
  }

  const db = getDb();
  const am = new URL(request.url).searchParams.get("am");
  const rows = (await getExportableBriefRows(db, {
    accountManagerId: am && UUID.test(am) ? am : undefined,
  })) as unknown as Record<string, unknown>[];

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Briefs");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="briefs-export-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
