/**
 * People and role administration (Admin only — callers must have run
 * requireAdmin / hasAccessRole("admin") first, same convention as the other
 * services). Every change is written to audit_events in the same transaction.
 *
 * Safeguards:
 *  - the last active Admin can't be removed or deactivated, so CPL can't lock
 *    itself out of rule-set and role management;
 *  - ending a role takes effect immediately (effective_to = yesterday), or
 *    deletes the row if it was only assigned today (the audit event keeps the
 *    record). Note: a signed-in user keeps the roles in their session token
 *    until they sign in again.
 */
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import { PENDING_PREFIX, normaliseUpn } from "../auth/provision-entra-user.js";

type Db = PostgresJsDatabase<typeof schema>;

export class PeopleAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeopleAdminError";
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

const currentRoleCondition = (d: string) =>
  and(
    lte(schema.roleHolders.effectiveFrom, d),
    or(isNull(schema.roleHolders.effectiveTo), gte(schema.roleHolders.effectiveTo, d)),
  );

export interface PersonRow {
  id: string;
  displayName: string;
  upn: string;
  active: boolean;
  signedInBefore: boolean;
  roles: string[];
}

export async function listPeople(db: Db): Promise<PersonRow[]> {
  const users = await db
    .select()
    .from(schema.users)
    .orderBy(asc(schema.users.displayName));
  const held = users.length
    ? await db
        .select({
          userId: schema.roleHolders.userId,
          roleKey: schema.roleHolders.roleKey,
        })
        .from(schema.roleHolders)
        .where(
          and(
            inArray(
              schema.roleHolders.userId,
              users.map((u) => u.id),
            ),
            currentRoleCondition(today()),
          ),
        )
    : [];
  return users.map((u) => ({
    id: u.id,
    displayName: u.displayName,
    upn: u.upn,
    active: u.active,
    signedInBefore: !u.entraObjectId.startsWith(PENDING_PREFIX),
    roles: held.filter((h) => h.userId === u.id).map((h) => h.roleKey),
  }));
}

export async function listRoleDefinitions(db: Db) {
  return db
    .select()
    .from(schema.roles)
    .orderBy(asc(schema.roles.category), asc(schema.roles.displayName));
}

async function activeAdminIds(db: Db): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.roleHolders.userId })
    .from(schema.roleHolders)
    .innerJoin(schema.users, eq(schema.users.id, schema.roleHolders.userId))
    .where(
      and(
        eq(schema.roleHolders.roleKey, "admin"),
        eq(schema.users.active, true),
        currentRoleCondition(today()),
      ),
    );
  return [...new Set(rows.map((r) => r.userId))];
}

async function audit(
  db: Db,
  actorId: string,
  action: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  await db.insert(schema.auditEvents).values({
    actorId,
    action,
    entityType: "user",
    entityId,
    before: before ?? null,
    after: after ?? null,
    requestCorrelationId: crypto.randomUUID(),
  });
}

export async function addPerson(
  db: Db,
  actorId: string,
  input: { upn: string; displayName: string },
): Promise<{ id: string }> {
  const upn = normaliseUpn(input.upn);
  const displayName = input.displayName.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(upn))
    throw new PeopleAdminError("Enter a valid work email address.");
  if (!displayName) throw new PeopleAdminError("Enter the person's name.");
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.upn}) = ${upn}`);
  if (existing) throw new PeopleAdminError("That person is already in the list.");
  return db.transaction(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({
        entraObjectId: `${PENDING_PREFIX}${upn}`,
        upn,
        displayName,
        email: upn,
        active: true,
      })
      .returning({ id: schema.users.id });
    await audit(tx as unknown as Db, actorId, "user.added", u!.id, null, {
      upn,
      displayName,
    });
    return { id: u!.id };
  });
}

export async function assignRole(
  db: Db,
  actorId: string,
  input: { userId: string; roleKey: string },
) {
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [user] = await t
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, input.userId));
    if (!user) throw new PeopleAdminError("Person not found.");
    const [role] = await t
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.key, input.roleKey));
    if (!role) throw new PeopleAdminError("Unknown role.");
    const [held] = await t
      .select({ id: schema.roleHolders.id })
      .from(schema.roleHolders)
      .where(
        and(
          eq(schema.roleHolders.userId, input.userId),
          eq(schema.roleHolders.roleKey, input.roleKey),
          currentRoleCondition(today()),
        ),
      );
    if (held)
      throw new PeopleAdminError(
        `${user.displayName} already holds ${role.displayName}.`,
      );
    await t
      .insert(schema.roleHolders)
      .values({ roleKey: input.roleKey, userId: input.userId, effectiveFrom: today() });
    await audit(t, actorId, "role.assigned", input.userId, null, {
      roleKey: input.roleKey,
    });
  });
}

export async function endRole(
  db: Db,
  actorId: string,
  input: { userId: string; roleKey: string },
) {
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    if (input.roleKey === "admin") {
      const admins = await activeAdminIds(t);
      if (admins.length <= 1 && admins.includes(input.userId))
        throw new PeopleAdminError(
          "This is the last active Admin. Make someone else an Admin first.",
        );
    }
    const rows = await t
      .select()
      .from(schema.roleHolders)
      .where(
        and(
          eq(schema.roleHolders.userId, input.userId),
          eq(schema.roleHolders.roleKey, input.roleKey),
          currentRoleCondition(today()),
        ),
      );
    if (rows.length === 0) throw new PeopleAdminError("That role isn't currently held.");
    for (const r of rows) {
      if (r.effectiveFrom >= today())
        await t.delete(schema.roleHolders).where(eq(schema.roleHolders.id, r.id));
      else
        await t
          .update(schema.roleHolders)
          .set({ effectiveTo: yesterday() })
          .where(eq(schema.roleHolders.id, r.id));
    }
    await audit(t, actorId, "role.ended", input.userId, { roleKey: input.roleKey }, null);
  });
}

export async function setPersonActive(
  db: Db,
  actorId: string,
  input: { userId: string; active: boolean },
) {
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [user] = await t
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, input.userId));
    if (!user) throw new PeopleAdminError("Person not found.");
    if (!input.active) {
      const admins = await activeAdminIds(t);
      if (admins.length <= 1 && admins.includes(input.userId))
        throw new PeopleAdminError(
          "This is the last active Admin. Make someone else an Admin first.",
        );
    }
    if (user.active === input.active) return;
    await t
      .update(schema.users)
      .set({ active: input.active, updatedAt: new Date() })
      .where(eq(schema.users.id, input.userId));
    await audit(
      t,
      actorId,
      input.active ? "user.reactivated" : "user.deactivated",
      input.userId,
      { active: user.active },
      { active: input.active },
    );
  });
}
