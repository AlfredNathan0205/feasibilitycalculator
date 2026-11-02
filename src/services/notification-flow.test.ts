import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { createBrief } from "./create-brief.js";
import { decideRequirement } from "./decide-requirement.js";
import {
  dispatchQueuedNotifications,
  parseAllowedRecipients,
} from "./notifications/dispatch-notifications.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

type Db = ReturnType<typeof drizzle<typeof schema>>;

class Rollback extends Error {}

describeIfDb("notification emails (integration, each test rolls back)", () => {
  let client: ReturnType<typeof postgres>;
  let db: Db;

  beforeAll(() => {
    client = postgres(databaseUrl!);
    db = drizzle(client, { schema });
  });
  afterAll(async () => {
    await client.end();
  });

  /** Runs fn inside a transaction that is always rolled back, so tests may
   * freely change who holds which role without touching shared test data. */
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

  const today = () => new Date().toISOString().slice(0, 10);
  const tag = () => Math.random().toString(36).slice(2, 9);

  async function user(tx: Db, name: string, active = true) {
    const id = `${name}-${tag()}`;
    const [u] = await tx
      .insert(schema.users)
      .values({
        entraObjectId: `test-notify-${id}`,
        upn: `${id}@notify.example`,
        displayName: name,
        email: `${id}@notify.example`,
        active,
      })
      .returning();
    return u!;
  }

  async function hold(tx: Db, userId: string, roleKey: string) {
    await tx
      .insert(schema.roleHolders)
      .values({ roleKey, userId, effectiveFrom: today() });
  }

  /** Nobody else holds these roles for the rest of the transaction. */
  async function clearHolders(tx: Db, roleKeys: string[]) {
    await tx
      .delete(schema.roleHolders)
      .where(inArray(schema.roleHolders.roleKey, roleKeys));
  }

  function deadline() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 60);
    return d;
  }

  function brief(submittedBy: string, over: Record<string, unknown> = {}) {
    return {
      customerReference: `NOTIFY-${tag()}`,
      tier: "A/T",
      valuePotentialGbp: 200_000,
      newRework: "New",
      briefType: "Exclusive",
      customerApproval: "Direct",
      nicheFfPreApproved: false,
      strategicPriority: false,
      creativeApproach: "Library Only",
      marketingFlag: false,
      ppdFlag: true,
      gcmsFlag: false,
      deadline: deadline(),
      submittedBy,
      ...over,
    } as Parameters<typeof createBrief>[1];
  }

  async function notificationsFor(tx: Db, briefId: string, template: string) {
    const rows = await tx
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.template, template));
    return rows.filter((n) => (n.payload as Record<string, unknown>).briefId === briefId);
  }

  it("emails every active holder of the role when a sign-off is raised, but not the submitter or inactive people", async () => {
    await inRollback(async (tx) => {
      await clearHolders(tx, ["ppd_manager"]);
      const submitter = await user(tx, "submitter");
      const a = await user(tx, "ppd-a");
      const b = await user(tx, "ppd-b");
      const gone = await user(tx, "ppd-left", false);
      await hold(tx, a.id, "ppd_manager");
      await hold(tx, b.id, "ppd_manager");
      await hold(tx, gone.id, "ppd_manager");
      await hold(tx, submitter.id, "ppd_manager"); // may not approve own brief

      const result = await createBrief(tx, brief(submitter.id));
      const rows = await notificationsFor(tx, result.briefId, "approval_requested");

      expect(rows.map((r) => r.recipientId).sort()).toEqual([a.id, b.id].sort());
      expect(rows[0]!.deliveryStatus).toBe("queued");
      expect((rows[0]!.payload as Record<string, unknown>).requirementTypes).toEqual([
        "ppd_resource",
      ]);
    });
  });

  it("sends one email per person per brief even when they hold several of the raised roles", async () => {
    await inRollback(async (tx) => {
      await clearHolders(tx, ["ppd_manager", "analytical_manager"]);
      const submitter = await user(tx, "submitter");
      const jo = await user(tx, "jo");
      await hold(tx, jo.id, "ppd_manager");
      await hold(tx, jo.id, "analytical_manager");

      const result = await createBrief(tx, brief(submitter.id, { gcmsFlag: true }));
      const rows = await notificationsFor(tx, result.briefId, "approval_requested");

      expect(rows).toHaveLength(1);
      expect(rows[0]!.recipientId).toBe(jo.id);
      expect(
        (
          (rows[0]!.payload as Record<string, unknown>).requirementTypes as string[]
        ).sort(),
      ).toEqual(["gcms_resource", "ppd_resource"]);
    });
  });

  it("tells the Admins instead when the only holders are the submitter (escalation)", async () => {
    await inRollback(async (tx) => {
      await clearHolders(tx, ["ppd_manager", "admin"]);
      const submitter = await user(tx, "submitter");
      const admin = await user(tx, "admin");
      await hold(tx, submitter.id, "ppd_manager");
      await hold(tx, admin.id, "admin");

      const result = await createBrief(tx, brief(submitter.id));
      const rows = await notificationsFor(tx, result.briefId, "approval_requested");

      expect(rows.map((r) => r.recipientId)).toEqual([admin.id]);
    });
  });

  it("does not ask approvers for sign-off on a brief that is already declined", async () => {
    await inRollback(async (tx) => {
      await clearHolders(tx, ["development_director"]);
      const submitter = await user(tx, "submitter");
      const dd = await user(tx, "dd");
      await hold(tx, dd.id, "development_director");

      const result = await createBrief(
        tx,
        brief(submitter.id, {
          tier: "D",
          newRework: "Rework (Non-Selling)",
          briefType: "ProActive",
          customerApproval: "Deferred/Unknown",
          creativeApproach: "Creation/Unknown",
          valuePotentialGbp: 0,
          ppdFlag: false,
        }),
      );
      expect(result.finalStatus).toBe("declined");
      expect(
        await notificationsFor(tx, result.briefId, "approval_requested"),
      ).toHaveLength(0);
    });
  });

  it("does not email approvers for a pre-approved sign-off (they get the revoke email instead)", async () => {
    await inRollback(async (tx) => {
      await clearHolders(tx, ["ppd_manager"]);
      const submitter = await user(tx, "submitter");
      const ppd = await user(tx, "ppd");
      await hold(tx, ppd.id, "ppd_manager");
      const result = await createBrief(
        tx,
        brief(submitter.id, {
          preApprovals: { ppd_resource: { nominatedManagerId: ppd.id, comment: "ok" } },
        }),
      );
      expect(
        await notificationsFor(tx, result.briefId, "approval_requested"),
      ).toHaveLength(0);
      expect(
        await notificationsFor(tx, result.briefId, "pre_approval_declared"),
      ).toHaveLength(1);
    });
  });

  it("emails the submitter and the Account Manager of record when the last sign-off is approved", async () => {
    await inRollback(async (tx) => {
      await clearHolders(tx, ["ppd_manager"]);
      const coordinator = await user(tx, "coordinator");
      const am = await user(tx, "am");
      const ppd = await user(tx, "ppd");
      await hold(tx, ppd.id, "ppd_manager");

      const created = await createBrief(tx, brief(coordinator.id, { onBehalfOf: am.id }));
      const requirement = (
        await tx
          .select()
          .from(schema.approvalRequirements)
          .where(eq(schema.approvalRequirements.briefId, created.briefId))
      )[0]!;
      expect(await notificationsFor(tx, created.briefId, "brief_approved")).toHaveLength(
        0,
      );

      const decided = await decideRequirement(tx, {
        requirementId: requirement.id,
        decidedBy: ppd.id,
        decision: "approve",
      });
      const rows = await notificationsFor(tx, created.briefId, "brief_approved");
      expect(rows.map((r) => r.recipientId).sort()).toEqual(
        [coordinator.id, am.id].sort(),
      );
      expect((rows[0]!.payload as Record<string, unknown>).approvalCode).toBe(
        decided.approvalCode,
      );
    });
  });

  it("does not email the submitter 'approved' while another sign-off is still open", async () => {
    await inRollback(async (tx) => {
      await clearHolders(tx, ["ppd_manager", "analytical_manager"]);
      const submitter = await user(tx, "submitter");
      const ppd = await user(tx, "ppd");
      const gcms = await user(tx, "gcms");
      await hold(tx, ppd.id, "ppd_manager");
      await hold(tx, gcms.id, "analytical_manager");

      const created = await createBrief(tx, brief(submitter.id, { gcmsFlag: true }));
      const ppdReq = (
        await tx
          .select()
          .from(schema.approvalRequirements)
          .where(
            and(
              eq(schema.approvalRequirements.briefId, created.briefId),
              eq(schema.approvalRequirements.requiredRoleKey, "ppd_manager"),
            ),
          )
      )[0]!;
      await decideRequirement(tx, {
        requirementId: ppdReq.id,
        decidedBy: ppd.id,
        decision: "approve",
      });
      expect(await notificationsFor(tx, created.briefId, "brief_approved")).toHaveLength(
        0,
      );
    });
  });

  it("emails the submitter with the approver's comment when a sign-off is rejected", async () => {
    await inRollback(async (tx) => {
      await clearHolders(tx, ["ppd_manager"]);
      const submitter = await user(tx, "submitter");
      const ppd = await user(tx, "ppd");
      await hold(tx, ppd.id, "ppd_manager");
      const created = await createBrief(tx, brief(submitter.id));
      const requirement = (
        await tx
          .select()
          .from(schema.approvalRequirements)
          .where(eq(schema.approvalRequirements.briefId, created.briefId))
      )[0]!;

      await decideRequirement(tx, {
        requirementId: requirement.id,
        decidedBy: ppd.id,
        decision: "reject",
        comment: "No PPD capacity before March",
      });
      const rows = await notificationsFor(tx, created.briefId, "requirement_rejected");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.recipientId).toBe(submitter.id);
      expect((rows[0]!.payload as Record<string, unknown>).comment).toBe(
        "No PPD capacity before March",
      );
    });
  });

  describe("recipient allowlist", () => {
    it("parses the environment value", () => {
      expect(parseAllowedRecipients(undefined)).toBeUndefined();
      expect(parseAllowedRecipients("  ")).toBeUndefined();
      expect(parseAllowedRecipients("A@x.com, @cplaromas.com")).toEqual([
        "a@x.com",
        "@cplaromas.com",
      ]);
    });

    it("suppresses mail to anyone not on the list and sends to those who are", async () => {
      await inRollback(async (tx) => {
        const allowed = await user(tx, "allowed");
        const blocked = await user(tx, "blocked");
        // Clear anything already queued so only these two rows are in play.
        await tx
          .update(schema.notifications)
          .set({ deliveryStatus: "failed" })
          .where(eq(schema.notifications.deliveryStatus, "queued"));
        await tx.insert(schema.notifications).values(
          [allowed, blocked].map((u) => ({
            recipientId: u.id,
            channel: "email" as const,
            template: "veto_reversed",
            payload: { customerReference: "ALLOWLIST" },
            deliveryStatus: "queued" as const,
          })),
        );
        const send = vi.fn(async () => {});
        const result = await dispatchQueuedNotifications(tx, send, {
          appBaseUrl: "https://app.example.com",
          allowedRecipients: [allowed.email],
        });

        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: allowed.email }));
        expect(result.sent).toBe(1);
        expect(result.suppressed).toBe(1);
        const [row] = await tx
          .select()
          .from(schema.notifications)
          .where(eq(schema.notifications.recipientId, blocked.id));
        expect(row!.deliveryStatus).toBe("suppressed");
        expect(row!.sentAt).toBeNull();
      });
    });
  });
});
