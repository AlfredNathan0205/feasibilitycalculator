import { NextResponse } from "next/server";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { auth } from "../../../../auth.js";
import * as schema from "../../../../db/schema.js";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  return drizzle(postgres(databaseUrl), { schema });
}

/**
 * §5 Stage C: "the named manager who gave the go-ahead, selected from the
 * people currently holding the relevant role." Serves the current holder
 * list so the submission form's dropdown only ever offers real, currently
 * valid choices — the server-side validation in createBrief.ts is the
 * actual authority; this just keeps the UI honest about what will pass.
 */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select({
      roleKey: schema.roleHolders.roleKey,
      userId: schema.users.id,
      displayName: schema.users.displayName,
    })
    .from(schema.roleHolders)
    .innerJoin(schema.users, eq(schema.users.id, schema.roleHolders.userId))
    .innerJoin(schema.roles, eq(schema.roles.key, schema.roleHolders.roleKey))
    .where(
      and(
        eq(schema.roles.category, "approval_authority"),
        lte(schema.roleHolders.effectiveFrom, today),
        or(
          isNull(schema.roleHolders.effectiveTo),
          gte(schema.roleHolders.effectiveTo, today),
        ),
      ),
    );

  return NextResponse.json({ holders: rows });
}
