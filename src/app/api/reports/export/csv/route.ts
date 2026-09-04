import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { auth } from "../../../../../auth.js";
import * as schema from "../../../../../db/schema.js";
import { hasAccessRole } from "../../../../../auth/authz.js";
import { getExportableBriefRows } from "../../../../../services/reporting.js";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  return drizzle(postgres(databaseUrl), { schema });
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET() {
  const session = await auth();
  if (!session) {
    return new Response("Not signed in", { status: 401 });
  }
  if (!hasAccessRole(session, "admin") && !hasAccessRole(session, "auditor")) {
    return new Response("Requires the Admin or Auditor role", { status: 403 });
  }

  const db = getDb();
  const rows = (await getExportableBriefRows(db)) as unknown as Record<string, unknown>[];

  const headers = rows.length > 0 ? Object.keys(rows[0]!) : [];
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(",")),
  ];
  const csv = lines.join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="briefs-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
