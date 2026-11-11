import { NextResponse } from "next/server";
import { auth } from "../../../../auth.js";
import { hasAccessRole } from "../../../../auth/authz.js";
import { getDb } from "../../../../lib/db.js";
import * as schema from "../../../../db/schema.js";
import { inArray } from "drizzle-orm";
import { listNicheBrands } from "../../../../services/niche-queries.js";

/**
 * GET /api/niche/brief-options: active niche brands with the assessment
 * currently in force, for the brief wizard's brand picker and live preview.
 * The server re-derives everything at submission; this is display data only.
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (
    !hasAccessRole(session, "account_manager") &&
    !hasAccessRole(session, "sales_coordinator")
  ) {
    return NextResponse.json(
      { error: "Requires the Account Manager or Sales Coordinator role" },
      { status: 403 },
    );
  }
  const db = getDb();
  const rows = await listNicheBrands(db, {});
  const current = rows.flatMap((r) =>
    r.latest && r.state !== "expired" ? [r.latest] : [],
  );
  const userIds = [
    ...new Set(
      current.flatMap((a) => [a.assessorId, a.reviewedBy].filter(Boolean) as string[]),
    ),
  ];
  const fwIds = [...new Set(current.map((a) => a.frameworkId))];
  const users = userIds.length
    ? await db
        .select({ id: schema.users.id, name: schema.users.displayName })
        .from(schema.users)
        .where(inArray(schema.users.id, userIds))
    : [];
  const fws = fwIds.length
    ? await db
        .select()
        .from(schema.nicheFrameworks)
        .where(inArray(schema.nicheFrameworks.id, fwIds))
    : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  return NextResponse.json({
    brands: rows.map((r) => {
      const cur = r.latest && r.state !== "expired" ? r.latest : null;
      return {
        id: r.id,
        name: r.name,
        customerReference: r.customerReference,
        current: cur && {
          id: cur.id,
          reference: cur.reference,
          band: cur.band,
          score: cur.score,
          validUntil: cur.validUntil,
          frameworkId: cur.frameworkId,
          assessor: name.get(cur.assessorId) ?? "",
          reviewer: cur.reviewedBy ? (name.get(cur.reviewedBy) ?? "") : "",
        },
      };
    }),
    frameworks: Object.fromEntries(
      fws.map((f) => [f.id, { version: f.version, payload: f.payload }]),
    ),
  });
}
