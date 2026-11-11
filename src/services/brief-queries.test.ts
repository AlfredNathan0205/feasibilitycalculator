import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import { createBrief } from "./create-brief.js";
import { briefScopeFor, getBriefDetail, listBriefs } from "./brief-queries.js";
import type { AuthSession } from "../auth/authz.js";

function session(partial: Partial<AuthSession>): AuthSession {
  return { userId: "u1", accessRoles: [], approvalAuthorityRoles: [], ...partial };
}

describe("briefScopeFor (pure)", () => {
  it("gives Admin and Auditor an unrestricted scope", () => {
    expect(briefScopeFor(session({ accessRoles: ["admin"] })).kind).toBe("all");
    expect(briefScopeFor(session({ accessRoles: ["auditor"] })).kind).toBe("all");
  });

  it("gives the General Manager (veto) every brief but not the audit trail", () => {
    expect(
      briefScopeFor(
        session({
          accessRoles: ["approver"],
          approvalAuthorityRoles: ["general_manager"],
        }),
      ),
    ).toEqual({ kind: "all", audit: false });
  });

  it("gives the Commercial Director every brief but not the audit trail", () => {
    expect(
      briefScopeFor(
        session({
          accessRoles: ["approver"],
          approvalAuthorityRoles: ["commercial_director"],
        }),
      ),
    ).toEqual({ kind: "all", audit: false });
    // Without the Approver access role the approval role grants nothing.
    expect(
      briefScopeFor(
        session({
          accessRoles: ["account_manager"],
          approvalAuthorityRoles: ["commercial_director"],
        }),
      ).kind,
    ).toBe("restricted");
  });

  it("restricts a submitter to their own briefs with no approval roles", () => {
    expect(briefScopeFor(session({ accessRoles: ["account_manager"] }))).toEqual({
      kind: "restricted",
      userId: "u1",
      approvalRoles: [],
    });
  });

  it("only carries approval roles for someone who actually holds the approver access role", () => {
    const withAccess = briefScopeFor(
      session({ accessRoles: ["approver"], approvalAuthorityRoles: ["ppd_manager"] }),
    );
    expect(withAccess).toMatchObject({ approvalRoles: ["ppd_manager"] });

    // Holding an approval-authority role without the approver access role
    // grants nothing — same rule as requireCanActOnRequirement.
    const without = briefScopeFor(
      session({
        accessRoles: ["account_manager"],
        approvalAuthorityRoles: ["ppd_manager"],
      }),
    );
    expect(without).toMatchObject({ approvalRoles: [] });
  });
});

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb("brief queries (integration)", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let aliceId: string;
  let bobId: string;
  const marker = `BQ-${Date.now()}`;
  let aliceBriefId: string;
  let bobBriefId: string;

  async function upsertUser(key: string) {
    const [u] = await db
      .insert(schema.users)
      .values({
        entraObjectId: `test-brief-queries-${key}`,
        upn: `brief-queries-${key}@cpl.example`,
        displayName: `BQ ${key}`,
        email: `brief-queries-${key}@cpl.example`,
        active: true,
      })
      .onConflictDoUpdate({ target: schema.users.upn, set: { active: true } })
      .returning();
    return u!.id;
  }

  function submit(submittedBy: string, customerReference: string, ppdFlag: boolean) {
    const deadline = new Date();
    deadline.setUTCDate(deadline.getUTCDate() + 60);
    return createBrief(db, {
      customerReference,
      tier: "A/T",
      valuePotentialGbp: 200_000,
      newRework: "New",
      briefType: "Exclusive",
      customerApproval: "Direct",
      nicheFfPreApproved: false,
      strategicPriority: false,
      creativeApproach: "Library Only",
      marketingFlag: false,
      ppdFlag,
      gcmsFlag: false,
      deadline,
      submittedBy,
    });
  }

  beforeAll(async () => {
    sql = postgres(databaseUrl!);
    db = drizzle(sql, { schema });
    aliceId = await upsertUser("alice");
    bobId = await upsertUser("bob");
    aliceBriefId = (await submit(aliceId, `${marker}-alice`, true)).briefId;
    bobBriefId = (await submit(bobId, `${marker}-bob`, false)).briefId;
  });

  afterAll(async () => {
    await sql.end();
  });

  const asAdmin = { kind: "all", audit: true } as const;
  const restrictedTo = (userId: string, approvalRoles: string[] = []) =>
    ({ kind: "restricted", userId, approvalRoles }) as const;

  it("a submitter sees only their own briefs", async () => {
    const result = await listBriefs(db, restrictedTo(aliceId), { q: marker });
    expect(result.total).toBe(1);
    expect(result.rows[0]!.id).toBe(aliceBriefId);
  });

  it("Admin scope sees both", async () => {
    const result = await listBriefs(db, asAdmin, { q: marker });
    expect(result.total).toBe(2);
  });

  it("an approver also sees briefs with a requirement routed to their role", async () => {
    // Bob submitted a brief with no requirements; Alice's has a ppd_resource one.
    const result = await listBriefs(db, restrictedTo(bobId, ["ppd_manager"]), {
      q: marker,
    });
    const ids = result.rows.map((r) => r.id).sort();
    expect(ids).toEqual([aliceBriefId, bobBriefId].sort());
  });

  it("filters by status and reports outstanding requirements", async () => {
    const pending = await listBriefs(db, asAdmin, { q: marker, status: "pending" });
    expect(pending.rows.map((r) => r.id)).toEqual([aliceBriefId]);
    expect(pending.rows[0]!.outstandingRequirements).toBe(1);

    const approved = await listBriefs(db, asAdmin, { q: marker, status: "approved" });
    expect(approved.rows.map((r) => r.id)).toEqual([bobBriefId]);
    expect(approved.rows[0]!.approvalCode).toMatch(/^FC-/);
  });

  it("treats LIKE wildcards in the search term literally", async () => {
    const result = await listBriefs(db, asAdmin, { q: `${marker}%` });
    expect(result.total).toBe(0);
  });

  it("paginates", async () => {
    const result = await listBriefs(db, asAdmin, { q: marker, pageSize: 1, page: 2 });
    expect(result.total).toBe(2);
    expect(result.rows).toHaveLength(1);
  });

  it("detail: owner sees requirements but no audit trail; Admin sees the trail", async () => {
    const own = await getBriefDetail(db, restrictedTo(aliceId), aliceBriefId);
    expect(own?.requirements).toHaveLength(1);
    expect(own?.requirements[0]!.requirementType).toBe("ppd_resource");
    expect(own?.auditEvents).toEqual([]);

    const admin = await getBriefDetail(db, asAdmin, aliceBriefId);
    expect(admin?.auditEvents.some((e) => e.action === "brief.submitted")).toBe(true);
    expect(admin?.ruleSetVersion).toBeGreaterThan(0);
  });

  it("detail: someone else's brief is indistinguishable from a missing one", async () => {
    expect(await getBriefDetail(db, restrictedTo(bobId), aliceBriefId)).toBeNull();
    expect(
      await getBriefDetail(db, asAdmin, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });
});
