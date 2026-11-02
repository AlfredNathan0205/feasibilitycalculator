import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { normaliseUpn, provisionEntraUser } from "./provision-entra-user.js";

describe("normaliseUpn", () => {
  it("lower-cases and trims", () => {
    expect(normaliseUpn("  Selena.Wagstaff@CPLAromas.com ")).toBe(
      "selena.wagstaff@cplaromas.com",
    );
  });
});

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("provisionEntraUser (integration)", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const k = `pe${Date.now()}`;
  const upn = (n: string) => `${k}-${n}@cpl.example`;

  beforeAll(() => {
    sql = postgres(databaseUrl!);
    db = drizzle(sql, { schema });
  });
  afterAll(async () => {
    await sql.end();
  });

  it("claims a pre-provisioned row (any UPN casing) and keeps its id", async () => {
    const [pre] = await db
      .insert(schema.users)
      .values({
        entraObjectId: `pending:${upn("a")}`,
        upn: upn("a"),
        displayName: "A",
        email: upn("a"),
      })
      .returning();
    const r = await provisionEntraUser(db, {
      objectId: `oid-${k}-a`,
      upn: upn("a").toUpperCase(),
      displayName: "Real A",
    });
    expect(r?.id).toBe(pre!.id);
    const [row] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, pre!.id));
    expect(row!.entraObjectId).toBe(`oid-${k}-a`);
    expect(row!.displayName).toBe("Real A");
  });

  it("mirrors an unknown person with no roles", async () => {
    const r = await provisionEntraUser(db, {
      objectId: `oid-${k}-b`,
      upn: upn("b"),
      displayName: "B",
    });
    expect(r).not.toBeNull();
    const holders = await db
      .select()
      .from(schema.roleHolders)
      .where(eq(schema.roleHolders.userId, r!.id));
    expect(holders).toHaveLength(0);
  });

  it("refuses a UPN already bound to a different identity", async () => {
    await provisionEntraUser(db, {
      objectId: `oid-${k}-c`,
      upn: upn("c"),
      displayName: "C",
    });
    expect(
      await provisionEntraUser(db, {
        objectId: `oid-${k}-c2`,
        upn: upn("c"),
        displayName: "C",
      }),
    ).toBeNull();
  });

  it("refuses a deactivated user", async () => {
    await provisionEntraUser(db, {
      objectId: `oid-${k}-d`,
      upn: upn("d"),
      displayName: "D",
    });
    await db
      .update(schema.users)
      .set({ active: false })
      .where(eq(schema.users.upn, upn("d")));
    expect(
      await provisionEntraUser(db, {
        objectId: `oid-${k}-d`,
        upn: upn("d"),
        displayName: "D",
      }),
    ).toBeNull();
  });
});
