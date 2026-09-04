import { NextResponse } from "next/server";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { auth } from "../../../../auth.js";
import * as schema from "../../../../db/schema.js";
import { requireAdmin, AuthorizationError } from "../../../../auth/authz.js";
import {
  updateDraftPayload,
  ValidationError,
  NotFoundError,
} from "../../../../services/rule-set-editor.js";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  return drizzle(postgres(databaseUrl), { schema });
}

export async function GET(
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
  const [ruleSet] = await db.select().from(schema.ruleSets).where(eq(schema.ruleSets.id, id));
  if (!ruleSet) {
    return NextResponse.json({ error: "Rule set not found" }, { status: 404 });
  }
  return NextResponse.json(ruleSet);
}

export async function PATCH(
  request: Request,
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
  let body: { payload?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.payload || typeof body.payload !== "object") {
    return NextResponse.json({ error: "Missing payload" }, { status: 400 });
  }

  const db = getDb();
  try {
    await updateDraftPayload(db, {
      ruleSetId: id,
      payload: body.payload as never,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
