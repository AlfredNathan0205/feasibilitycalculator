/**
 * Applies the roles seed and publishes rule set version 1, read from
 * ruleset-v1.generated.json (produced by `npm run seed:generate-ruleset`).
 *
 * Deliberately does NOT regenerate the rule set from the workbook itself —
 * that's a separate, reviewable step (§10 item 1: read the lookups, THEN
 * seed). This script only loads whatever's already on disk, so a human can
 * diff the generated JSON before it's ever written to the database.
 *
 * Idempotent: safe to re-run. Roles are upserted; rule set v1 is only
 * inserted if version 1 doesn't already exist.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { roles, ruleSets, users } from "../schema.js";
import { rolesSeed } from "./roles.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set to apply the seed");
  }

  const rulesetPath = path.join(__dirname, "ruleset-v1.generated.json");
  const payload = JSON.parse(readFileSync(rulesetPath, "utf-8"));
  console.log(
    `Loaded rule set payload generated from ${payload.sourceWorkbook.fileName} at ${payload.sourceWorkbook.generatedAt}`,
  );

  const sql = postgres(databaseUrl);
  const db = drizzle(sql);

  try {
    // --- Roles: idempotent upsert -------------------------------------
    for (const role of rolesSeed) {
      await db
        .insert(roles)
        .values(role)
        .onConflictDoUpdate({
          target: roles.key,
          set: {
            displayName: role.displayName,
            description: role.description,
            category: role.category,
          },
        });
    }
    console.log(`Seeded ${rolesSeed.length} roles.`);

    // --- Bootstrap system user for created_by/published_by attribution -
    // This represents the build/migration process itself, not a real
    // person, purely so rule_sets.created_by/published_by satisfy their
    // NOT NULL foreign keys for the initial seed. Replace with the real
    // Admin who ratifies v1 once the app is live and Entra sign-in exists.
    const [systemUser] = await db
      .insert(users)
      .values({
        entraObjectId: "00000000-0000-0000-0000-000000000000",
        upn: "system-seed@cplaromas.com",
        displayName: "System (initial seed)",
        email: "system-seed@cplaromas.com",
        active: false,
      })
      .onConflictDoUpdate({
        target: users.entraObjectId,
        set: { displayName: "System (initial seed)" },
      })
      .returning();

    if (!systemUser) {
      throw new Error("Failed to upsert the bootstrap system user");
    }

    // --- Rule set v1: insert once, then publish ------------------------
    const existing = await db.select().from(ruleSets).where(eq(ruleSets.version, 1));

    if (existing.length > 0) {
      console.log("Rule set version 1 already exists — skipping insert.");
    } else {
      await db.insert(ruleSets).values({
        version: 1,
        status: "published",
        payload,
        createdBy: systemUser.id,
        publishedBy: systemUser.id,
        publishedAt: new Date(),
      });
      console.log("Inserted and published rule set version 1.");
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
