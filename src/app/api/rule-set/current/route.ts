import { NextResponse } from "next/server";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, desc } from "drizzle-orm";
import { auth } from "../../../../auth.js";
import * as schema from "../../../../db/schema.js";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  return drizzle(postgres(databaseUrl), { schema });
}

/**
 * Serves the current published rule set's payload so the submission
 * wizard can compute a LIVE score preview client-side using the exact
 * same pure engine (src/engine/scoring.ts, decision.ts) the server uses —
 * one source of truth for the math, not a re-implementation in the UI
 * layer that could drift from it.
 */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const db = getDb();
  const [ruleSet] = await db
    .select({ version: schema.ruleSets.version, payload: schema.ruleSets.payload })
    .from(schema.ruleSets)
    .where(eq(schema.ruleSets.status, "published"))
    .orderBy(desc(schema.ruleSets.version))
    .limit(1);

  if (!ruleSet) {
    return NextResponse.json({ error: "No published rule set found" }, { status: 404 });
  }

  return NextResponse.json(ruleSet);
}
