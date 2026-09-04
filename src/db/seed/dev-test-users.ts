/**
 * Not part of the production seed — this only exists to populate a handful
 * of test users with distinct roles for local ALLOW_DEV_LOGIN testing.
 * Safe to re-run (idempotent upserts).
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import { users, roleHolders } from "../schema.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  const sql = postgres(databaseUrl);
  const db = drizzle(sql);

  const testUsers = [
    {
      entraObjectId: "11111111-1111-1111-1111-111111111111",
      upn: "am@cpl.example",
      displayName: "Amara Manager (Account Manager)",
      email: "am@cpl.example",
      accessRole: "account_manager",
    },
    {
      entraObjectId: "22222222-2222-2222-2222-222222222222",
      upn: "ppd@cpl.example",
      displayName: "Priya PPD (PPD Manager, Approver)",
      email: "ppd@cpl.example",
      accessRole: "approver",
      approvalAuthorityRole: "ppd_manager",
    },
    {
      entraObjectId: "33333333-3333-3333-3333-333333333333",
      upn: "admin@cpl.example",
      displayName: "Adrian Admin",
      email: "admin@cpl.example",
      accessRole: "admin",
    },
  ] as const;

  for (const tu of testUsers) {
    const [user] = await db
      .insert(users)
      .values({
        entraObjectId: tu.entraObjectId,
        upn: tu.upn,
        displayName: tu.displayName,
        email: tu.email,
        active: true,
      })
      .onConflictDoUpdate({
        target: users.upn,
        set: { displayName: tu.displayName, active: true },
      })
      .returning();

    if (!user) continue;

    async function ensureRole(roleKey: string) {
      const existing = await db
        .select()
        .from(roleHolders)
        .where(and(eq(roleHolders.roleKey, roleKey), eq(roleHolders.userId, user!.id)));
      if (existing.length === 0) {
        await db.insert(roleHolders).values({
          roleKey,
          userId: user!.id,
          effectiveFrom: new Date().toISOString().slice(0, 10),
        });
      }
    }

    await ensureRole(tu.accessRole);
    if ("approvalAuthorityRole" in tu && tu.approvalAuthorityRole) {
      await ensureRole(tu.approvalAuthorityRole);
    }

    console.log(
      `Seeded ${tu.upn} with role(s): ${tu.accessRole}${"approvalAuthorityRole" in tu ? ", " + tu.approvalAuthorityRole : ""}`,
    );
  }

  await sql.end();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
