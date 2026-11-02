import { NextResponse } from "next/server";
import { auth } from "../../../../auth.js";
import { hasAccessRole } from "../../../../auth/authz.js";
import { getDashboardSummary } from "../../../../services/reporting.js";
import { getDb } from "../../../../lib/db.js";

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
