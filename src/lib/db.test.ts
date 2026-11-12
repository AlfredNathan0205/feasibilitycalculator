import { afterAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("getDb stall guard", () => {
  vi.stubEnv("DB_READ_TIMEOUT_MS", "300");
  afterAll(() => vi.unstubAllEnvs());

  it("runs ordinary reads and writes", async () => {
    const { getDb } = await import("./db.js");
    const db = getDb();
    const rows = await db.execute(sql`select 1 as n`);
    expect(rows[0]?.n).toBe(1);
  });

  it("gives up on a read that never answers instead of hanging, then keeps working", async () => {
    const { getDb } = await import("./db.js");
    const db = getDb();
    const started = Date.now();
    await expect(db.execute(sql`select pg_sleep(30)`)).rejects.toMatchObject({
      cause: { name: "QueryStalled" },
    });
    // 3 attempts x 300 ms, nowhere near 30 s
    expect(Date.now() - started).toBeLessThan(5000);
    const rows = await db.execute(sql`select 2 as n`);
    expect(rows[0]?.n).toBe(2);
  });

  it("starts from a fresh pool after an idle gap and still answers", async () => {
    const { getDb } = await import("./db.js");
    const db = getDb();
    await db.execute(sql`select 1`);
    await new Promise((r) => setTimeout(r, 2300));
    const rows = await db.execute(sql`select 3 as n`);
    expect(rows[0]?.n).toBe(3);
  });

  it("does not retry writes", async () => {
    const { getDb } = await import("./db.js");
    const db = getDb();
    const started = Date.now();
    await expect(
      db.execute(sql`do $$ begin perform pg_sleep(1); end $$`),
    ).resolves.toBeDefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });
});

describe("resolveDatabaseUrl", () => {
  it("moves the Supabase pooler from transaction to session mode", async () => {
    const { resolveDatabaseUrl } = await import("./db.js");
    expect(
      resolveDatabaseUrl(
        "postgresql://u:p@aws-0-eu-west-2.pooler.supabase.com:6543/postgres",
      ),
    ).toBe("postgresql://u:p@aws-0-eu-west-2.pooler.supabase.com:5432/postgres");
  });
  it("leaves other URLs alone", async () => {
    const { resolveDatabaseUrl } = await import("./db.js");
    const local = "postgresql://cpl:cpl@localhost:5432/cpl";
    expect(resolveDatabaseUrl(local)).toBe(local);
    expect(resolveDatabaseUrl("postgresql://u:p@db.x.supabase.co:6543/postgres")).toBe(
      "postgresql://u:p@db.x.supabase.co:6543/postgres",
    );
  });
});
