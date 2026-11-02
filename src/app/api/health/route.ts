import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "../../../lib/db.js";

export const dynamic = "force-dynamic";

/**
 * Unauthenticated health probe for Azure App Service / load balancers.
 * Reveals nothing beyond up/down. `?db=1` also checks the database round trip.
 */
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("db") === "1") {
    try {
      await getDb().execute(sql`select 1`);
    } catch {
      return NextResponse.json({ status: "degraded", database: "down" }, { status: 503 });
    }
    return NextResponse.json({ status: "ok", database: "up" });
  }
  return NextResponse.json({ status: "ok" });
}
