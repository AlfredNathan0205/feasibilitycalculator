/**
 * Creates niche framework v1 as PUBLISHED from niche-framework-v1.generated.json
 * (run `tsx src/db/seed/generate-niche-framework-v1.ts` first to regenerate).
 * Idempotent: does nothing if version 1 already exists.
 * Usage: DATABASE_URL=... npm run seed:niche
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { nicheFrameworks, users } from "../schema.js";
import {
  validateNicheFramework,
  type NicheFrameworkPayload,
} from "../../engine/niche-assessment.js";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set");
  const file = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "niche-framework-v1.generated.json",
  );
  const { sourceNote, payload } = JSON.parse(readFileSync(file, "utf-8")) as {
    sourceNote: string;
    payload: NicheFrameworkPayload;
  };
  const errors = validateNicheFramework(payload);
  if (errors.length) throw new Error(`Framework v1 is invalid: ${errors.join("; ")}`);

  const sql = postgres(url);
  const db = drizzle(sql);
  try {
    const existing = await db
      .select()
      .from(nicheFrameworks)
      .where(eq(nicheFrameworks.version, 1));
    if (existing.length) {
      console.log("Niche framework version 1 already exists — skipping.");
      return;
    }
    // Same bootstrap attribution user as the rule set seed (no real person).
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
    await db.insert(nicheFrameworks).values({
      version: 1,
      status: "published",
      payload,
      sourceNote,
      createdBy: systemUser!.id,
      publishedBy: systemUser!.id,
      publishedAt: new Date(),
    });
    console.log("Inserted and published niche framework version 1.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
