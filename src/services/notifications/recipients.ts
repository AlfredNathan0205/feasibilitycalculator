/**
 * Who should be told about a sign-off. Kept separate from the services that
 * raise notifications so the rule is written down once:
 *
 *  - every ACTIVE person who currently holds the approval role, except the
 *    people who may not decide this brief (the submitter and the Account
 *    Manager of record);
 *  - if that leaves nobody, the requirement has been escalated (see
 *    shouldEscalateRequirement), so the active Admins are told instead.
 */
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../db/schema.js";

type Db = PostgresJsDatabase<typeof schema>;

async function activeHolderIds(db: Db, roleKey: string, asOf: Date): Promise<string[]> {
  const day = asOf.toISOString().slice(0, 10);
  const rows = await db
    .select({ userId: schema.roleHolders.userId })
    .from(schema.roleHolders)
    .innerJoin(schema.users, eq(schema.users.id, schema.roleHolders.userId))
    .where(
      and(
        eq(schema.roleHolders.roleKey, roleKey),
        eq(schema.users.active, true),
        lte(schema.roleHolders.effectiveFrom, day),
        or(
          isNull(schema.roleHolders.effectiveTo),
          gte(schema.roleHolders.effectiveTo, day),
        ),
      ),
    );
  return [...new Set(rows.map((r) => r.userId))];
}

export async function listApprovalRecipients(
  db: Db,
  roleKey: string,
  asOf: Date,
  excludeUserIds: Array<string | null | undefined>,
): Promise<string[]> {
  const excluded = new Set(excludeUserIds.filter((id): id is string => !!id));
  const holders = (await activeHolderIds(db, roleKey, asOf)).filter(
    (id) => !excluded.has(id),
  );
  if (holders.length > 0) return holders;
  return (await activeHolderIds(db, "admin", asOf)).filter((id) => !excluded.has(id));
}

/** People to tell about the outcome of a brief: whoever submitted it, plus the
 * Account Manager of record when a coordinator submitted on their behalf. */
export async function listBriefOwnerRecipients(
  db: Db,
  brief: { submittedBy: string; onBehalfOf: string | null },
): Promise<string[]> {
  const ids = [
    ...new Set([brief.submittedBy, brief.onBehalfOf].filter(Boolean)),
  ] as string[];
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(inArray(schema.users.id, ids), eq(schema.users.active, true)));
  return rows.map((r) => r.id);
}
