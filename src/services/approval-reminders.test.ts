import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { createBrief } from "./create-brief.js";
import {
  DEFAULT_REMINDER_CONFIG,
  enqueueApprovalReminders,
  isWorkingTimeLondon,
  reminderConfigFromEnv,
} from "./approval-reminders.js";
import { renderNotificationEmail } from "./notifications/render-email.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describe("isWorkingTimeLondon", () => {
  it("is true on a weekday morning, false at weekends and overnight", () => {
    expect(isWorkingTimeLondon(new Date("2026-11-12T10:00:00Z"))).toBe(true); // Thu
    expect(isWorkingTimeLondon(new Date("2026-11-14T10:00:00Z"))).toBe(false); // Sat
    expect(isWorkingTimeLondon(new Date("2026-11-12T06:00:00Z"))).toBe(false); // 06:00
    expect(isWorkingTimeLondon(new Date("2026-11-12T19:00:00Z"))).toBe(false); // 19:00
  });
});

describe("reminderConfigFromEnv", () => {
  it("uses defaults and ignores nonsense", () => {
    expect(reminderConfigFromEnv({})).toEqual({
      ...DEFAULT_REMINDER_CONFIG,
      since: undefined,
    });
    expect(
      reminderConfigFromEnv({
        APPROVAL_REMINDER_AFTER_HOURS: "24",
        APPROVAL_REMINDER_REPEAT_HOURS: "abc",
        APPROVAL_ESCALATE_AFTER_HOURS: "-5",
      }),
    ).toEqual({ ...DEFAULT_REMINDER_CONFIG, remindAfterHours: 24, since: undefined });
    expect(
      reminderConfigFromEnv({
        APPROVAL_REMINDERS_SINCE: "2026-11-12",
      }).since?.toISOString(),
    ).toBe("2026-11-12T00:00:00.000Z");
    expect(
      reminderConfigFromEnv({ APPROVAL_REMINDERS_SINCE: "nonsense" }).since,
    ).toBeUndefined();
  });
});

describe("approval reminder emails", () => {
  it("renders a reminder and an escalation", () => {
    const payload = {
      total: 2,
      items: [
        {
          customerReference: "ACME-1",
          requirementType: "ppd_resource",
          roleKey: "ppd_manager",
          waitingDays: 3,
          deadline: "2026-12-01",
        },
        {
          customerReference: "ACME-2",
          requirementType: "marketing_resource",
          roleKey: "marketing_manager",
          waitingDays: 1,
          deadline: null,
        },
      ],
    };
    const r = renderNotificationEmail("approval_reminder", payload, "https://x.test/");
    expect(r.subject).toBe("Reminder: 2 sign-offs waiting for you");
    expect(r.text).toContain("ACME-1: PPD resource sign-off, waiting 3 days");
    expect(r.text).toContain("waiting 1 day");
    expect(r.text).toContain("https://x.test/approvals");
    const e = renderNotificationEmail("approval_escalation", payload, "https://x.test");
    expect(e.subject).toBe("2 sign-offs waiting too long");
    expect(e.text).toContain("(ppd manager)");
  });
});

describeIfDb("approval reminders (integration, each test rolls back)", () => {
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  type Db = typeof db;
  class Rollback extends Error {}

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
  const today = () => new Date().toISOString().slice(0, 10);
  const NOW = new Date("2026-11-12T10:00:00Z"); // a Thursday morning
  const cfg = { remindAfterHours: 48, repeatEveryHours: 48, escalateAfterHours: 120 };

  async function user(tx: Db, name: string) {
    const id = `${name}-${tag()}`;
    const [u] = await tx
      .insert(schema.users)
      .values({
        entraObjectId: `test-remind-${id}`,
        upn: `${id}@remind.example`,
        displayName: name,
        email: `${id}@remind.example`,
        active: true,
      })
      .returning();
    return u!;
  }
  async function hold(tx: Db, userId: string, roleKey: string) {
    await tx
      .insert(schema.roleHolders)
      .values({ roleKey, userId, effectiveFrom: today() });
  }
  async function raised(tx: Db, submitterId: string, hoursAgo: number) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 60);
    const result = await createBrief(tx, {
      customerReference: `REMIND-${tag()}`,
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
      deadline: d,
      submittedBy: submitterId,
    } as Parameters<typeof createBrief>[1]);
    await tx
      .update(schema.approvalRequirements)
      .set({ createdAt: new Date(NOW.getTime() - hoursAgo * 3_600_000) })
      .where(eq(schema.approvalRequirements.briefId, result.briefId));
    return result;
  }
  async function sent(tx: Db, recipientId: string, template: string) {
    return tx
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.recipientId, recipientId))
      .then((rows) => rows.filter((r) => r.template === template));
  }
  /** Shared test data already holds pending sign-offs; settle them (inside the
   * rolled-back transaction) so each test sees only its own. */
  async function clear(tx: Db, roles: string[]) {
    await tx
      .update(schema.approvalRequirements)
      .set({ state: "approved" })
      .where(eq(schema.approvalRequirements.state, "pending"));
    await tx.delete(schema.roleHolders).where(inArray(schema.roleHolders.roleKey, roles));
  }

  it("reminds the approver about a sign-off older than the threshold, once", async () => {
    await inRollback(async (tx) => {
      await clear(tx, ["ppd_manager", "admin"]);
      const submitter = await user(tx, "submitter");
      const ppd = await user(tx, "ppd");
      await hold(tx, ppd.id, "ppd_manager");
      await raised(tx, submitter.id, 60);

      const first = await enqueueApprovalReminders(tx, NOW, cfg);
      expect(first.reminders).toBe(1);
      const rows = await sent(tx, ppd.id, "approval_reminder");
      expect(rows).toHaveLength(1);
      const payload = rows[0]!.payload as {
        total: number;
        items: Array<{ waitingDays: number }>;
      };
      expect(payload.total).toBe(1);
      expect(payload.items[0]!.waitingDays).toBe(2);

      // Running again straight away (the cron runs every 5 minutes) sends nothing.
      const again = await enqueueApprovalReminders(
        tx,
        new Date(NOW.getTime() + 300_000),
        cfg,
      );
      expect(again.reminders).toBe(0);
      expect(await sent(tx, ppd.id, "approval_reminder")).toHaveLength(1);

      // Two days later it nags again.
      const later = await enqueueApprovalReminders(
        tx,
        new Date(NOW.getTime() + 48 * 3_600_000),
        cfg,
        { ignoreWorkingHours: true },
      );
      expect(later.reminders).toBe(1);
    });
  });

  it("leaves recent sign-offs, decided ones and declined briefs alone", async () => {
    await inRollback(async (tx) => {
      await clear(tx, ["ppd_manager", "admin"]);
      const submitter = await user(tx, "submitter");
      const ppd = await user(tx, "ppd");
      await hold(tx, ppd.id, "ppd_manager");

      await raised(tx, submitter.id, 10); // too recent
      const decided = await raised(tx, submitter.id, 100);
      await tx
        .update(schema.approvalRequirements)
        .set({ state: "approved" })
        .where(eq(schema.approvalRequirements.briefId, decided.briefId));
      const declined = await raised(tx, submitter.id, 100);
      await tx
        .update(schema.decisions)
        .set({ finalStatus: "declined" })
        .where(eq(schema.decisions.briefId, declined.briefId));

      const r = await enqueueApprovalReminders(tx, NOW, cfg);
      expect(r).toEqual({ reminders: 0, escalations: 0 });
    });
  });

  it("ignores sign-offs raised before the 'since' date", async () => {
    await inRollback(async (tx) => {
      await clear(tx, ["ppd_manager", "admin"]);
      const submitter = await user(tx, "submitter");
      const ppd = await user(tx, "ppd");
      await hold(tx, ppd.id, "ppd_manager");
      await raised(tx, submitter.id, 100); // raised ~4 days before NOW
      const since = new Date(NOW.getTime() - 24 * 3_600_000); // yesterday
      expect(await enqueueApprovalReminders(tx, NOW, { ...cfg, since })).toEqual({
        reminders: 0,
        escalations: 0,
      });
      const older = new Date(NOW.getTime() - 200 * 3_600_000);
      expect(
        (await enqueueApprovalReminders(tx, NOW, { ...cfg, since: older })).reminders,
      ).toBe(1);
    });
  });

  it("sends nothing at the weekend", async () => {
    await inRollback(async (tx) => {
      await clear(tx, ["ppd_manager", "admin"]);
      const submitter = await user(tx, "submitter");
      const ppd = await user(tx, "ppd");
      await hold(tx, ppd.id, "ppd_manager");
      await raised(tx, submitter.id, 100);
      const sat = new Date("2026-11-14T10:00:00Z");
      expect(await enqueueApprovalReminders(tx, sat, cfg)).toEqual({
        reminders: 0,
        escalations: 0,
      });
    });
  });

  it("tells the Admins about sign-offs that have waited past the escalation threshold", async () => {
    await inRollback(async (tx) => {
      await clear(tx, ["ppd_manager", "admin"]);
      const submitter = await user(tx, "submitter");
      const ppd = await user(tx, "ppd");
      const admin = await user(tx, "admin");
      await hold(tx, ppd.id, "ppd_manager");
      await hold(tx, admin.id, "admin");
      await raised(tx, submitter.id, 130); // past 5 days
      await raised(tx, submitter.id, 60); // stale but not escalated

      const r = await enqueueApprovalReminders(tx, NOW, cfg);
      expect(r).toEqual({ reminders: 1, escalations: 1 });
      const esc = await sent(tx, admin.id, "approval_escalation");
      expect(esc).toHaveLength(1);
      expect((esc[0]!.payload as { total: number }).total).toBe(1);
      expect((await sent(tx, ppd.id, "approval_reminder"))[0]!.payload).toMatchObject({
        total: 2,
      });
    });
  });

  it("does not send an Admin an escalation for something they are already asked to approve", async () => {
    await inRollback(async (tx) => {
      await clear(tx, ["ppd_manager", "admin"]);
      const submitter = await user(tx, "submitter");
      const admin = await user(tx, "admin");
      await hold(tx, admin.id, "admin");
      // nobody holds ppd_manager: the Admin is the approver (escalated requirement)
      await raised(tx, submitter.id, 130);
      const r = await enqueueApprovalReminders(tx, NOW, cfg);
      expect(r).toEqual({ reminders: 1, escalations: 0 });
      expect(await sent(tx, admin.id, "approval_reminder")).toHaveLength(1);
    });
  });
});
