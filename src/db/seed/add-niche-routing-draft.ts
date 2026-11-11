/**
 * Creates a draft rule set that adds the niche assessment routing (three
 * requirement types, enabled, plus allowManualFineFragrance). Does NOT publish:
 * open the draft in the rule set editor, run the replay, and publish it there.
 *
 * Usage: DATABASE_URL=... tsx src/db/seed/add-niche-routing-draft.ts <admin-upn>
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../schema.js";
import { createNicheRoutingDraft } from "../../services/niche-rollout.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  const upn = process.argv[2];
  if (!upn) throw new Error("Usage: add-niche-routing-draft.ts <admin-upn>");

  const sql = postgres(databaseUrl);
  const db = drizzle(sql, { schema });
  try {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.upn, upn));
    if (!user) throw new Error(`No user with upn ${upn} (they must have signed in once)`);

    const result = await createNicheRoutingDraft(db, { createdBy: user.id });
    if (result.status === "already_published") {
      console.log(
        `Rule set v${result.version} already enables the niche routing. Nothing to do.`,
      );
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
