import { NextResponse } from "next/server";
import { auth } from "../../../auth.js";
import { requireAdmin, AuthorizationError } from "../../../auth/authz.js";
import { createDraftRuleSet, listRuleSets } from "../../../services/rule-set-editor.js";
import { getDb } from "../../../lib/db.js";

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
