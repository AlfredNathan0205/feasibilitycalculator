import { NextResponse } from "next/server";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { auth } from "../../../../../auth.js";
import * as schema from "../../../../../db/schema.js";
import { requireAdmin, AuthorizationError } from "../../../../../auth/authz.js";
import {
  publishRuleSet,
  ValidationError,
  NotFoundError,
} from "../../../../../services/rule-set-editor.js";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  return drizzle(postgres(databaseUrl), { schema });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;
  const db = getDb();
  try {
    await publishRuleSet(db, { ruleSetId: id, publishedBy: session.userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal error publishing" }, { status: 500 });
  }
}
