import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import { createBrief } from "./create-brief.js";
import { listBriefs, type BriefScope } from "./brief-queries.js";
import {
  getBriefsByAccountManager,
  getDashboardSummary,
  getMonthlyActivity,
  listAccountManagersWithBriefs,
} from "./reporting.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

type Db = ReturnType<typeof drizzle<typeof schema>>;
class Rollback extends Error {}

describeIfDb("account manager views (integration, each test rolls back)", () => {
  let client: ReturnType<typeof postgres>;
  let db: Db;

  beforeAll(() => {
    client = postgres(databaseUrl!);
    db = drizzle(client, { schema });
  });
  afterAll(async () => {
    await client.end();
  });

  async function inRollback(fn: (tx: Db) => Promise<void>) {
    try {
      await db.transaction(async (tx) => {
        await fn(tx as unknown as Db);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  }

  const tag = () => Math.random().toString(36).slice(2, 9);

  async function user(tx: Db, name: string) {
    const id = `${name}-${tag()}`;
    const [u] = await tx
      .insert(schema.users)
      .values({
        entraObjectId: `test-am-${id}`,
        upn: `${id}@am.example`,
        displayName: name,
        email: `${id}@am.example`,
        active: true,
      })
      .returning();
    return u!;
  }

  function deadline() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 60);
    return d;
  }

  function brief(submittedBy: string, over: Record<string, unknown> = {}) {
    return {
      customerReference: `AM-${tag()}`,
      tier: "A/T",
      valuePotentialGbp: 100_000,
      newRework: "New",
      briefType: "Exclusive",
      customerApproval: "Direct",
      nicheFfPreApproved: false,
      strategicPriority: false,
      creativeApproach: "Library Only",
      marketingFlag: false,
      ppdFlag: false,
      gcmsFlag: false,
      deadline: deadline(),
      submittedBy,
      ...over,
    } as Parameters<typeof createBrief>[1];
  }

  const adminScope: BriefScope = { kind: "all", audit: true };

  it("filters the brief list by Account Manager of record, including briefs raised on their behalf", async () => {
    await inRollback(async (tx) => {
      const kellie = await user(tx, "Kellie");
      const chloe = await user(tx, "Chloe");
      const coordinator = await user(tx, "Coordinator");
      const own = await createBrief(tx, brief(kellie.id));
      const forKellie = await createBrief(
        tx,
        brief(coordinator.id, { onBehalfOf: kellie.id }),
      );
      const chloes = await createBrief(tx, brief(chloe.id));

      const k = await listBriefs(tx, adminScope, { accountManagerId: kellie.id });
      expect(k.rows.map((r) => r.id).sort()).toEqual(
        [own.briefId, forKellie.briefId].sort(),
      );
      const onBehalf = k.rows.find((r) => r.id === forKellie.briefId)!;
      expect(onBehalf.onBehalfOfName).toBe("Kellie");
      expect(onBehalf.submitterName).toBe("Coordinator");

      const c = await listBriefs(tx, adminScope, { accountManagerId: chloe.id });
      expect(c.rows.map((r) => r.id)).toEqual([chloes.briefId]);
      expect(c.total).toBe(1);

      // Combines with the other filters.
      const none = await listBriefs(tx, adminScope, {
        accountManagerId: chloe.id,
        tier: "D",
      });
      expect(none.rows).toHaveLength(0);
    });
  });

  it("lists as Account Managers only people who have a brief, counting on-behalf briefs for the manager", async () => {
    await inRollback(async (tx) => {
      const am = await user(tx, "Real-AM");
      const coordinator = await user(tx, "Real-Coordinator");
      await user(tx, "Never-Submitted");
      await createBrief(tx, brief(coordinator.id, { onBehalfOf: am.id }));

      const names = (await listAccountManagersWithBriefs(tx)).map((a) => a.id);
      expect(names).toContain(am.id);
      expect(names).not.toContain(coordinator.id);
    });
  });

  it("summarises briefs by Account Manager with status, waiting sign-offs and value", async () => {
    await inRollback(async (tx) => {
      const am = await user(tx, "Summary-AM");
      await createBrief(tx, brief(am.id)); // no requirements: approved straight away
      await createBrief(tx, brief(am.id, { ppdFlag: true, valuePotentialGbp: 50_000 }));

      const row = (await getBriefsByAccountManager(tx)).find(
        (r) => r.accountManagerId === am.id,
      )!;
      expect(row.total).toBe(2);
      expect(row.approved).toBe(1);
      expect(row.pending).toBe(1);
      expect(row.declined).toBe(0);
      expect(row.outstandingSignOffs).toBe(1);
      expect(row.valuePotentialGbp).toBe(150_000);
    });
  });

  it("shows month-by-month volume and resource demand, narrowed to one Account Manager", async () => {
    await inRollback(async (tx) => {
      const am = await user(tx, "Monthly-AM");
      const other = await user(tx, "Monthly-Other");
      await createBrief(tx, brief(am.id, { ppdFlag: true, gcmsFlag: true }));
      await createBrief(tx, brief(am.id, { marketingFlag: true }));
      await createBrief(tx, brief(other.id, { ppdFlag: true })); // must not count

      const rows = await getMonthlyActivity(tx, { accountManagerId: am.id });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        briefs: 2,
        valuePotentialGbp: 200_000,
        ppd: 1,
        gcms: 1,
        marketing: 1,
        creative: 0,
      });
      expect(rows[0]!.month).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  it("narrows every brief panel on the dashboard, but not the by-Account-Manager table", async () => {
    await inRollback(async (tx) => {
      const am = await user(tx, "Dash-AM");
      const other = await user(tx, "Dash-Other");
      await createBrief(tx, brief(am.id, { tier: "B" }));
      await createBrief(tx, brief(other.id, { tier: "B" }));

      const filtered = await getDashboardSummary(tx, { accountManagerId: am.id });
      expect(filtered.volumeByTier).toEqual([{ dimension: "B", count: 1 }]);
      expect(filtered.volumeOutcomeMixByMonth.reduce((n, r) => n + r.count, 0)).toBe(1);
      expect(filtered.scoreDistribution.reduce((n, b) => n + b.count, 0)).toBe(1);
      const ids = filtered.briefsByAccountManager.map((r) => r.accountManagerId);
      expect(ids).toContain(am.id);
      expect(ids).toContain(other.id);
    });
  });
});
