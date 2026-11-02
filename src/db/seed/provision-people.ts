/**
 * Loads src/db/seed/people.ts into users + role_holders. Idempotent: safe to
 * re-run. Users are created with a placeholder Entra object id that their
 * first real Microsoft sign-in replaces (see auth/provision-entra-user.ts).
 * Never removes roles — use the role-holder screen / effective_to for that.
 *
 * Usage: DATABASE_URL=... tsx src/db/seed/provision-people.ts
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as schema from "../schema.js";
import { people } from "./people.js";
import { PENDING_PREFIX } from "../../auth/provision-entra-user.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client, { schema });
  const today = new Date().toISOString().slice(0, 10);
  try {
    const known = new Set(
      (await db.select({ key: schema.roles.key }).from(schema.roles)).map((r) => r.key),
    );
    for (const p of people) {
      for (const r of p.roles) {
        if (!known.has(r))
          throw new Error(`Unknown role "${r}" for ${p.upn} — run the roles seed first`);
      }
      const upn = p.upn.toLowerCase();
      let [user] = await db
        .select()
        .from(schema.users)
        .where(sql`lower(${schema.users.upn}) = ${upn}`);
      if (!user) {
        [user] = await db
          .insert(schema.users)
          .values({
            entraObjectId: `${PENDING_PREFIX}${upn}`,
            upn,
            displayName: p.displayName,
            email: upn,
            active: true,
          })
          .returning();
      }
      for (const roleKey of p.roles) {
        const [held] = await db
          .select({ id: schema.roleHolders.id })
          .from(schema.roleHolders)
          .where(
            and(
              eq(schema.roleHolders.userId, user!.id),
              eq(schema.roleHolders.roleKey, roleKey),
              isNull(schema.roleHolders.effectiveTo),
            ),
          );
        if (!held)
          await db
            .insert(schema.roleHolders)
            .values({ roleKey, userId: user!.id, effectiveFrom: today });
      }
      console.log(`${upn}: ${p.roles.join(", ") || "(no roles yet)"}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
