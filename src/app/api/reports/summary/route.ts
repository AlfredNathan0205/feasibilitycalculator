import { NextResponse } from "next/server";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { auth } from "../../../../auth.js";
import * as schema from "../../../../db/schema.js";
import { hasAccessRole } from "../../../../auth/authz.js";
import { getDashboardSummary } from "../../../../services/reporting.js";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  return drizzle(postgres(databaseUrl), { schema });
}

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!hasAccessRole(session, "admin") && !hasAccessRole(session, "auditor")) {
    return NextResponse.json(
      { error: "Requires the Admin or Auditor role" },
      { status: 403 },
    );
  }
  const db = getDb();
  const summary = await getDashboardSummary(db);
  return NextResponse.json(summary);
}
