import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema.js";
import {
  PeopleAdminError,
  addPerson,
  assignRole,
  endRole,
  listPeople,
  setPersonActive,
} from "./people-admin.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("people admin (integration)", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let actor: string;
  const k = `pa${Date.now()}`;
  const mail = (n: string) => `${k}-${n}@cpl.example`;

  beforeAll(async () => {
    sql = postgres(databaseUrl!);
    db = drizzle(sql, { schema });
    const [u] = await db
      .insert(schema.users)
      .values({
        entraObjectId: `test-${k}-actor`,
        upn: mail("actor"),
        displayName: "Actor",
        email: mail("actor"),
      })
      .returning();
    actor = u!.id;
  });
  afterAll(async () => {
    await sql.end();
  });

  const rolesOf = async (id: string) =>
    (await listPeople(db)).find((p) => p.id === id)?.roles ?? [];

  it("adds a person (lower-cased, pending sign-in) and rejects duplicates and bad emails", async () => {
    const { id } = await addPerson(db, actor, {
      upn: mail("A").toUpperCase(),
      displayName: " Ann ",
    });
    const p = (await listPeople(db)).find((x) => x.id === id)!;
    expect(p.upn).toBe(mail("a"));
    expect(p.displayName).toBe("Ann");
    expect(p.signedInBefore).toBe(false);
    await expect(
      addPerson(db, actor, { upn: mail("a"), displayName: "Ann" }),
    ).rejects.toThrow(PeopleAdminError);
    await expect(addPerson(db, actor, { upn: "nope", displayName: "X" })).rejects.toThrow(
      /valid work email/,
    );
  });

  it("assigns and ends a role, with audit events, and refuses duplicates", async () => {
    const { id } = await addPerson(db, actor, { upn: mail("b"), displayName: "Bea" });
    await assignRole(db, actor, { userId: id, roleKey: "approver" });
    await assignRole(db, actor, { userId: id, roleKey: "ppd_manager" });
    expect((await rolesOf(id)).sort()).toEqual(["approver", "ppd_manager"]);
    await expect(
      assignRole(db, actor, { userId: id, roleKey: "approver" }),
    ).rejects.toThrow(/already holds/);
    await expect(
      assignRole(db, actor, { userId: id, roleKey: "nonsense" }),
    ).rejects.toThrow(/Unknown role/);
    await endRole(db, actor, { userId: id, roleKey: "ppd_manager" });
    expect(await rolesOf(id)).toEqual(["approver"]);
    await expect(
      endRole(db, actor, { userId: id, roleKey: "ppd_manager" }),
    ).rejects.toThrow(/isn't currently held/);
    const events = await db
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.entityId, id),
          inArray(schema.auditEvents.action, [
            "user.added",
            "role.assigned",
            "role.ended",
          ]),
        ),
      );
    expect(events.map((e) => e.action).sort()).toEqual([
      "role.assigned",
      "role.assigned",
      "role.ended",
      "user.added",
    ]);
  });

  it("deactivate and reactivate", async () => {
    const { id } = await addPerson(db, actor, { upn: mail("c"), displayName: "Cy" });
    await setPersonActive(db, actor, { userId: id, active: false });
    expect((await listPeople(db)).find((p) => p.id === id)!.active).toBe(false);
    await setPersonActive(db, actor, { userId: id, active: true });
    expect((await listPeople(db)).find((p) => p.id === id)!.active).toBe(true);
  });

  it("never removes or deactivates the last active Admin", async () => {
    class Rollback extends Error {}
    await expect(
      db.transaction(async (tx) => {
        const t = tx as unknown as typeof db;
        // Within this rolled-back transaction, leave exactly one active admin.
        const { id: sole } = await addPerson(t, actor, {
          upn: mail("sole"),
          displayName: "Sole",
        });
        await t
          .update(schema.users)
          .set({ active: false })
          .where(
            and(
              eq(schema.users.active, true),
              inArray(
                schema.users.id,
                (await listPeople(t))
                  .filter((p) => p.roles.includes("admin"))
                  .map((p) => p.id),
              ),
            ),
          );
        await setPersonActive(t, actor, { userId: sole, active: true });
        await assignRole(t, actor, { userId: sole, roleKey: "admin" });
        await expect(
          endRole(t, actor, { userId: sole, roleKey: "admin" }),
        ).rejects.toThrow(/last active Admin/);
        await expect(
          setPersonActive(t, actor, { userId: sole, active: false }),
        ).rejects.toThrow(/last active Admin/);
        // With a second admin, removal is allowed.
        const { id: other } = await addPerson(t, actor, {
          upn: mail("other"),
          displayName: "Other",
        });
        await assignRole(t, actor, { userId: other, roleKey: "admin" });
        await endRole(t, actor, { userId: sole, roleKey: "admin" });
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
