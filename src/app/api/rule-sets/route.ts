import { NextResponse } from "next/server";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { auth } from "../../../auth.js";
import * as schema from "../../../db/schema.js";
import { requireAdmin, AuthorizationError } from "../../../auth/authz.js";
import { createDraftRuleSet, listRuleSets } from "../../../services/rule-set-editor.js";

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
  try {
    requireAdmin(session);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
  const db = getDb();
  const ruleSets = await listRuleSets(db);
  return NextResponse.json({ ruleSets });
}

export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  try {
    requireAdmin(session);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const db = getDb();
  const draft = await createDraftRuleSet(db, { createdBy: session.userId });
  return NextResponse.json(draft, { status: 201 });
}
