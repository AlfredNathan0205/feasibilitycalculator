/**
 * Creates a draft rule set that splits tier "A/T" into A and T (tier T = Target
 * account, always approved by the Commercial Director). Does NOT publish: open
 * the draft in the rule set editor, run the replay, and publish it there.
 *
 * Usage: DATABASE_URL=... tsx src/db/seed/add-tier-t-draft.ts <admin-upn>
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../schema.js";
import { createTierTDraft } from "../../services/tier-t-migration.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  const upn = process.argv[2];
  if (!upn) throw new Error("Usage: add-tier-t-draft.ts <admin-upn>");

  const sql = postgres(databaseUrl);
  const db = drizzle(sql, { schema });
  try {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.upn, upn));
    if (!user) throw new Error(`No user with upn ${upn} (they must have signed in once)`);

    const result = await createTierTDraft(db, { createdBy: user.id });
    if (result.status === "already_published") {
      console.log(`Rule set v${result.version} already defines tier T. Nothing to do.`);
    } else {
      console.log(
        `Created draft rule set v${result.version} (${result.ruleSetId}). ` +
          "Review it in Admin > Rule sets, run the replay, then publish.",
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
