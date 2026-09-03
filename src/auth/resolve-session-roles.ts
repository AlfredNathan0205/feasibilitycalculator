/**
 * Resolves a user's currently-held roles from `role_holders`, split into
 * access roles and approval-authority roles (see `roles.category` from
 * `src/db/seed/roles.ts`). This is the ONLY place role information is read
 * from the database — everything in `authz.ts` is pure and takes the
 * resolved result, never a client-supplied claim (§2: "Never trust a role
 * claim read on the client").
 *
 * Called from the NextAuth `jwt` callback on sign-in, so the resolved roles
 * are baked into the session token server-side, not re-derived from
 * anything the browser sends on each request.
 */

import { and, eq, isNull, lte, or, gte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { roleHolders, roles } from "../db/schema.js";
import type * as schema from "../db/schema.js";
import type { AuthSession } from "./authz.js";

export async function resolveSessionRoles(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
  asOf: Date = new Date(),
): Promise<Omit<AuthSession, "userId">> {
  const rows = await db
    .select({ roleKey: roleHolders.roleKey, category: roles.category })
    .from(roleHolders)
    .innerJoin(roles, eq(roles.key, roleHolders.roleKey))
    .where(
      and(
        eq(roleHolders.userId, userId),
        lte(roleHolders.effectiveFrom, asOf.toISOString().slice(0, 10)),
        or(
          isNull(roleHolders.effectiveTo),
          gte(roleHolders.effectiveTo, asOf.toISOString().slice(0, 10)),
        ),
      ),
    );

  const accessRoles: string[] = [];
  const approvalAuthorityRoles: string[] = [];
  for (const row of rows) {
    if (row.category === "access") accessRoles.push(row.roleKey);
    else approvalAuthorityRoles.push(row.roleKey);
  }

  return { accessRoles, approvalAuthorityRoles };
}
