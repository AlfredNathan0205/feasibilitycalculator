/**
 * Shared by createBrief (immediate-clear case) and decideRequirement
 * (a brief becoming clear after its last outstanding approval resolves) —
 * one place implementing "regenerate on collision" (§6) rather than two
 * copies that could drift.
 */
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { generateApprovalCode } from "../engine/approval-code.js";

const MAX_CODE_COLLISION_RETRIES = 10;

export async function issueUniqueApprovalCode(
  tx: PostgresJsDatabase<typeof schema>,
  now: Date,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_CODE_COLLISION_RETRIES; attempt++) {
    const candidate = generateApprovalCode(now);
    const [clash] = await tx
      .select({ id: schema.decisions.id })
      .from(schema.decisions)
      .where(eq(schema.decisions.approvalCode, candidate));
    if (!clash) return candidate;
  }
  throw new Error(
    `Failed to generate a unique Approval Code after ${MAX_CODE_COLLISION_RETRIES} attempts`,
  );
}
