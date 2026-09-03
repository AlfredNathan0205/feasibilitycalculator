import { NextResponse } from "next/server";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { auth } from "../../../auth.js";
import * as schema from "../../../db/schema.js";
import { hasAccessRole } from "../../../auth/authz.js";
import { createBrief, ValidationError } from "../../../services/create-brief.js";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  return drizzle(postgres(databaseUrl), { schema });
}

/**
 * POST /api/briefs — §5/§9 submission wizard's final step.
 *
 * Authorization: AccountManager or SalesCoordinator only (§2). This is the
 * single authorization check point for this route — createBrief() itself
 * does no authz, per "all server-side data access must go through a single
 * authorisation layer" (§2): the route checks, the service just does work.
 *
 * A SalesCoordinator submitting on behalf of someone else must supply
 * `onBehalfOf` (§2: "submitting on behalf of someone else must record both
 * identities"). An AccountManager submitting their own brief leaves it
 * null. This route doesn't enforce that onBehalfOf can only be set by a
 * coordinator — that's a product-policy nicety for a later pass, not a
 * security boundary (the audit trail always records who actually hit the
 * endpoint, in `submittedBy`, regardless).
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (
    !hasAccessRole(session, "account_manager") &&
    !hasAccessRole(session, "sales_coordinator")
  ) {
    return NextResponse.json(
      { error: "Requires the Account Manager or Sales Coordinator role" },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const requiredStringFields = [
    "customerReference",
    "tier",
    "newRework",
    "briefType",
    "customerApproval",
    "creativeApproach",
    "deadline",
  ] as const;
  for (const field of requiredStringFields) {
    if (typeof body[field] !== "string" || body[field] === "") {
      return NextResponse.json(
        { error: `Missing or invalid field: ${field}` },
        { status: 400 },
      );
    }
  }
  if (typeof body.valuePotentialGbp !== "number") {
    return NextResponse.json(
      { error: "valuePotentialGbp must be a number" },
      { status: 400 },
    );
  }

  const deadline = new Date(body.deadline as string);
  if (Number.isNaN(deadline.getTime())) {
    return NextResponse.json(
      { error: "deadline must be a valid date" },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const result = await createBrief(db, {
      customerReference: body.customerReference as string,
      tier: body.tier as string,
      valuePotentialGbp: body.valuePotentialGbp as number,
      newRework: body.newRework as string,
      briefType: body.briefType as string,
      customerApproval: body.customerApproval as string,
      nicheFfPreApproved: Boolean(body.nicheFfPreApproved),
      nicheFfRationale: (body.nicheFfRationale as string) ?? null,
      strategicPriority: Boolean(body.strategicPriority),
      strategicPriorityRationale:
        (body.strategicPriorityRationale as string) ?? null,
      creativeApproach: body.creativeApproach as string,
      marketingFlag: Boolean(body.marketingFlag),
      ppdFlag: Boolean(body.ppdFlag),
      gcmsFlag: Boolean(body.gcmsFlag),
      deadline,
      pvReference: (body.pvReference as string) ?? null,
      submittedBy: session.userId,
      onBehalfOf: (body.onBehalfOf as string) ?? null,
      preApprovals: (body.preApprovals as Record<string, { nominatedManagerId: string; comment: string }>) ?? undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json(
      { error: "Internal error creating brief" },
      { status: 500 },
    );
  }
}
