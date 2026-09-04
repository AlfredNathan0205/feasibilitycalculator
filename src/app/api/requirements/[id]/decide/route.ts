import { NextResponse } from "next/server";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { auth } from "../../../../../auth.js";
import * as schema from "../../../../../db/schema.js";
import {
  requireCanDecideRequirement,
  AuthorizationError,
} from "../../../../../auth/authz.js";
import {
  decideRequirement,
  ValidationError,
  NotFoundError,
} from "../../../../../services/decide-requirement.js";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  return drizzle(postgres(databaseUrl), { schema });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id: requirementId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.decision !== "approve" && body.decision !== "reject") {
    return NextResponse.json(
      { error: 'decision must be "approve" or "reject"' },
      { status: 400 },
    );
  }

  const db = getDb();

  // Look up the requirement + brief BEFORE authorizing — the authz check
  // needs the requirement's requiredRoleKey and the brief's submitter/
  // on-behalf-of identity (§2: approver-role match AND self-approval
  // check), so this read has to happen first. This route is the single
  // authorization checkpoint (§2) — decideRequirement() itself does none.
  const [requirement] = await db
    .select()
    .from(schema.approvalRequirements)
    .where(eq(schema.approvalRequirements.id, requirementId));
  if (!requirement) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }
  const [brief] = await db
    .select()
    .from(schema.briefs)
    .where(eq(schema.briefs.id, requirement.briefId));
  if (!brief) {
    return NextResponse.json({ error: "Brief not found" }, { status: 404 });
  }

  try {
    requireCanDecideRequirement(
      session,
      { submittedBy: brief.submittedBy, onBehalfOf: brief.onBehalfOf },
      { requiredRoleKey: requirement.requiredRoleKey },
    );
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  try {
    const result = await decideRequirement(db, {
      requirementId,
      decidedBy: session.userId,
      decision: body.decision,
      comment: (body.comment as string) ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json(
      { error: "Internal error deciding requirement" },
      { status: 500 },
    );
  }
}
