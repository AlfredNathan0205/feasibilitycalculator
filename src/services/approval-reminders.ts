/**
 * Reminders for sign-offs that have been waiting too long.
 *
 *  - An approver with a pending sign-off older than `remindAfterHours` gets ONE
 *    digest email listing all their stale items, at most once every
 *    `repeatEveryHours` (template `approval_reminder`).
 *  - Items older than `escalateAfterHours` are also reported to the Admins
 *    (template `approval_escalation`), unless the Admin is already one of that
 *    item's approvers. Same throttle.
 *  - Nothing is sent at weekends or before 08:00 London time.
 *
 * "Waiting" runs from when the requirement was raised. Only requirements that
 * are still `pending` on a brief that is still undecided are included, so a
 * declined or vetoed brief never nags anyone. Recipients follow the same rule
 * as the original request (`listApprovalRecipients`): active holders of the
 * role except the submitter and Account Manager of record, or the Admins when
 * that leaves nobody.
 *
 * Thresholds (adopted from the agreed defaults, 12 Nov 2026) are set with
 * APPROVAL_REMINDER_AFTER_HOURS, APPROVAL_REMINDER_REPEAT_HOURS and
 * APPROVAL_ESCALATE_AFTER_HOURS. APPROVAL_REMINDERS_SINCE (an ISO date) skips
 * sign-offs raised before it, so test data from before go-live is ignored. Idempotent: state lives in the notifications
 * table, so running it every few minutes (the dispatch cron) is safe.
 */
import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import { listApprovalRecipients } from "./notifications/recipients.js";

type Db = PostgresJsDatabase<typeof schema>;

export interface ReminderConfig {
  remindAfterHours: number;
  repeatEveryHours: number;
  escalateAfterHours: number;
  /** Ignore sign-offs raised before this moment (e.g. test data from before go-live). */
  since?: Date;
}

export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  remindAfterHours: 48,
  repeatEveryHours: 48,
  escalateAfterHours: 120,
};

export function reminderConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): ReminderConfig {
  const num = (v: string | undefined, d: number) => {
    const n = Number.parseFloat(v ?? "");
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  const since = env.APPROVAL_REMINDERS_SINCE
    ? new Date(env.APPROVAL_REMINDERS_SINCE)
    : undefined;
  return {
    since: since && !Number.isNaN(since.getTime()) ? since : undefined,
    remindAfterHours: num(
      env.APPROVAL_REMINDER_AFTER_HOURS,
      DEFAULT_REMINDER_CONFIG.remindAfterHours,
    ),
    repeatEveryHours: num(
      env.APPROVAL_REMINDER_REPEAT_HOURS,
      DEFAULT_REMINDER_CONFIG.repeatEveryHours,
    ),
    escalateAfterHours: num(
      env.APPROVAL_ESCALATE_AFTER_HOURS,
      DEFAULT_REMINDER_CONFIG.escalateAfterHours,
    ),
  };
}

/** Weekday and hour in London, so reminders arrive in working hours. */
export function isWorkingTimeLondon(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  return !["Sat", "Sun"].includes(weekday) && hour >= 8 && hour < 18;
}

export interface ReminderItem {
  requirementId: string;
  briefId: string;
  customerReference: string;
  requirementType: string;
  roleKey: string;
  waitingDays: number;
  deadline: string | null;
}

const MAX_ITEMS_PER_EMAIL = 25;

async function lastSentAt(
  db: Db,
  recipientId: string,
  template: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: schema.notifications.createdAt })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.recipientId, recipientId),
        eq(schema.notifications.template, template),
      ),
    )
    .orderBy(desc(schema.notifications.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

async function queueDigest(
  db: Db,
  recipientId: string,
  template: "approval_reminder" | "approval_escalation",
  items: ReminderItem[],
) {
  const sorted = [...items].sort((a, b) => b.waitingDays - a.waitingDays);
  await db.insert(schema.notifications).values({
    recipientId,
    template,
    payload: {
      items: sorted.slice(0, MAX_ITEMS_PER_EMAIL),
      total: sorted.length,
    },
  });
}

export async function enqueueApprovalReminders(
  db: Db,
  now: Date = new Date(),
  config: ReminderConfig = reminderConfigFromEnv(),
  opts: { ignoreWorkingHours?: boolean } = {},
): Promise<{ reminders: number; escalations: number }> {
  if (!opts.ignoreWorkingHours && !isWorkingTimeLondon(now)) {
    return { reminders: 0, escalations: 0 };
  }
  const HOUR = 3_600_000;
  const staleBefore = new Date(now.getTime() - config.remindAfterHours * HOUR);

  const rows = await db
    .select({
      requirementId: schema.approvalRequirements.id,
      requirementType: schema.approvalRequirements.requirementType,
      roleKey: schema.approvalRequirements.requiredRoleKey,
      raisedAt: schema.approvalRequirements.createdAt,
      briefId: schema.briefs.id,
      customerReference: schema.briefs.customerReference,
      deadline: schema.briefs.deadline,
      submittedBy: schema.briefs.submittedBy,
      onBehalfOf: schema.briefs.onBehalfOf,
    })
    .from(schema.approvalRequirements)
    .innerJoin(schema.briefs, eq(schema.briefs.id, schema.approvalRequirements.briefId))
    .innerJoin(schema.decisions, eq(schema.decisions.briefId, schema.briefs.id))
    .where(
      and(
        eq(schema.approvalRequirements.state, "pending"),
        eq(schema.decisions.finalStatus, "pending"),
        lte(schema.approvalRequirements.createdAt, staleBefore),
        config.since
          ? gte(schema.approvalRequirements.createdAt, config.since)
          : undefined,
      ),
    );
  if (rows.length === 0) return { reminders: 0, escalations: 0 };

  const recipientCache = new Map<string, string[]>();
  const perRecipient = new Map<string, ReminderItem[]>();
  const escalatable: Array<{ item: ReminderItem; approvers: Set<string> }> = [];

  for (const r of rows) {
    const key = `${r.roleKey}|${r.submittedBy}|${r.onBehalfOf ?? ""}`;
    let recipients = recipientCache.get(key);
    if (!recipients) {
      recipients = await listApprovalRecipients(db, r.roleKey, now, [
        r.submittedBy,
        r.onBehalfOf,
      ]);
      recipientCache.set(key, recipients);
    }
    const ageHours = (now.getTime() - r.raisedAt.getTime()) / HOUR;
    const item: ReminderItem = {
      requirementId: r.requirementId,
      briefId: r.briefId,
      customerReference: r.customerReference,
      requirementType: r.requirementType,
      roleKey: r.roleKey,
      waitingDays: Math.floor(ageHours / 24),
      deadline: r.deadline ? new Date(r.deadline).toISOString().slice(0, 10) : null,
    };
    for (const id of recipients) {
      const list = perRecipient.get(id) ?? [];
      list.push(item);
      perRecipient.set(id, list);
    }
    if (ageHours >= config.escalateAfterHours) {
      escalatable.push({ item, approvers: new Set(recipients) });
    }
  }

  const throttleMs = config.repeatEveryHours * HOUR - HOUR; // an hour of slack for cron drift
  const due = async (id: string, template: string) => {
    const last = await lastSentAt(db, id, template);
    return !last || now.getTime() - last.getTime() >= throttleMs;
  };

  let reminders = 0;
  for (const [recipientId, items] of perRecipient) {
    if (!(await due(recipientId, "approval_reminder"))) continue;
    await queueDigest(db, recipientId, "approval_reminder", items);
    reminders++;
  }

  let escalations = 0;
  if (escalatable.length > 0) {
    const admins = await listApprovalRecipients(db, "admin", now, []);
    for (const adminId of admins) {
      const items = escalatable
        .filter((e) => !e.approvers.has(adminId))
        .map((e) => e.item);
      if (items.length === 0) continue;
      if (!(await due(adminId, "approval_escalation"))) continue;
      await queueDigest(db, adminId, "approval_escalation", items);
      escalations++;
    }
  }
  return { reminders, escalations };
}
