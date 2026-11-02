/**
 * Links a Microsoft Entra sign-in to a row in `users` (Build Prompt §8:
 * "mirrored from Entra on sign-in").
 *
 * Roles live in role_holders, keyed by users.id, so every Entra sign-in must
 * resolve to a users row. Admins can pre-provision people (by UPN) before
 * they ever sign in; those rows carry a placeholder entra_object_id
 * ("pending:<upn>") that the first real sign-in replaces with the true
 * object id. Anyone not pre-provisioned is mirrored with NO roles, so they
 * can sign in but see and do nothing until an Admin assigns a role.
 *
 * Returns null when sign-in must be refused:
 *  - the user is deactivated, or
 *  - the UPN is already bound to a *different* Entra object id (a reused
 *    UPN must not inherit a leaver's roles).
 */
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";

type Db = PostgresJsDatabase<typeof schema>;

export const PENDING_PREFIX = "pending:";

export interface EntraClaims {
  objectId: string;
  upn: string;
  displayName: string;
  email?: string | null;
}

export function normaliseUpn(upn: string): string {
  return upn.trim().toLowerCase();
}

export async function provisionEntraUser(
  db: Db,
  claims: EntraClaims,
): Promise<{ id: string } | null> {
  const upn = normaliseUpn(claims.upn);
  const email = normaliseUpn(claims.email || claims.upn);
  const displayName = claims.displayName.trim() || upn;

  const [byObjectId] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.entraObjectId, claims.objectId));
  if (byObjectId) {
    if (!byObjectId.active) return null;
    await db
      .update(schema.users)
      .set({ upn, email, displayName, updatedAt: new Date() })
      .where(eq(schema.users.id, byObjectId.id));
    return { id: byObjectId.id };
  }

  const [byUpn] = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.upn}) = ${upn}`);
  if (byUpn) {
    if (!byUpn.active) return null;
    if (!byUpn.entraObjectId.startsWith(PENDING_PREFIX)) return null;
    await db
      .update(schema.users)
      .set({
        entraObjectId: claims.objectId,
        upn,
        email,
        displayName,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, byUpn.id));
    return { id: byUpn.id };
  }

  const [created] = await db
    .insert(schema.users)
    .values({ entraObjectId: claims.objectId, upn, displayName, email, active: true })
    .returning({ id: schema.users.id });
  return created ?? null;
}
