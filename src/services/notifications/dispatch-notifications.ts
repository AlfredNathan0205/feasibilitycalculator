/**
 * dispatchQueuedNotifications — the send half of the notifications outbox
 * (§8 `notifications` table; rows queued by createBrief and
 * decideRequirement/revokeRequirement, see those files' comments).
 *
 * Same convention as the rest of this codebase's services: this takes an
 * already-open db handle and does its own transactions internally; it does
 * not decide who's allowed to trigger it (the API route does that).
 *
 * The actual network call is injected as `sendEmail` rather than hardcoded
 * to a specific provider — this file is fully testable against a real
 * Postgres database with a stub sender (matching this project's existing
 * testing philosophy), and the real Resend HTTP call lives separately in
 * src/lib/resend.ts, wired in only at the API route.
 *
 * Concurrency: each notification is claimed with `SELECT ... FOR UPDATE
 * SKIP LOCKED` inside its own short transaction before the network call,
 * and updated to sent/failed in that same transaction after. If two
 * dispatch invocations overlap (e.g. a slow-running cron tick plus a
 * manually triggered one), the second one skips whatever the first has
 * already claimed rather than blocking or double-sending.
 */

import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../db/schema.js";
import { renderNotificationEmail } from "./render-email.js";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Should throw on failure to send — dispatch treats a thrown error as a
 * failed send and records it, rather than requiring the caller to encode
 * success/failure in a return value. */
export type SendEmailFn = (message: EmailMessage) => Promise<void>;

export interface DispatchOptions {
  /** Deployment origin used to build absolute links in emails (e.g. the
   * revoke link). Pass NEXTAUTH_URL. */
  appBaseUrl: string;
  /** Cap on how many queued notifications a single call processes, so one
   * dispatch invocation can't run unboundedly long. Default 50. */
  batchSize?: number;
}

export interface DispatchResult {
  attempted: number;
  sent: number;
  failed: number;
  /** Notifications another concurrent run had already claimed — not an
   * error, just informational. */
  skippedLocked: number;
  failures: Array<{ notificationId: string; error: string }>;
}

export async function dispatchQueuedNotifications(
  db: PostgresJsDatabase<typeof schema>,
  sendEmail: SendEmailFn,
  options: DispatchOptions,
): Promise<DispatchResult> {
  const batchSize = options.batchSize ?? 50;
  const appBaseUrl = options.appBaseUrl;

  const candidates = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(eq(schema.notifications.deliveryStatus, "queued"))
    .limit(batchSize);

  const result: DispatchResult = {
    attempted: 0,
    sent: 0,
    failed: 0,
    skippedLocked: 0,
    failures: [],
  };

  for (const { id } of candidates) {
    const outcome = await db.transaction(async (tx) => {
      const [claimed] = await tx
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.id, id),
            eq(schema.notifications.deliveryStatus, "queued"),
          ),
        )
        .for("update", { skipLocked: true });

      if (!claimed) {
        // Either another concurrent dispatch run claimed it first, or it
        // was already sent/failed between the outer select and here.
        return { status: "skipped" as const };
      }

      const [recipient] = await tx
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, claimed.recipientId));

      if (!recipient) {
        const message = `Notification ${id} references missing recipient ${claimed.recipientId}`;
        await tx
          .update(schema.notifications)
          .set({ deliveryStatus: "failed" })
          .where(eq(schema.notifications.id, id));
        return { status: "failed" as const, error: message };
      }

      try {
        const rendered = renderNotificationEmail(
          claimed.template,
          claimed.payload as Record<string, unknown>,
          appBaseUrl,
        );
        await sendEmail({
          to: recipient.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
        await tx
          .update(schema.notifications)
          .set({ deliveryStatus: "sent", sentAt: new Date() })
          .where(eq(schema.notifications.id, id));
        return { status: "sent" as const };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await tx
          .update(schema.notifications)
          .set({ deliveryStatus: "failed" })
          .where(eq(schema.notifications.id, id));
        return { status: "failed" as const, error: message };
      }
    });

    if (outcome.status === "skipped") {
      result.skippedLocked += 1;
      continue;
    }

    result.attempted += 1;
    if (outcome.status === "sent") {
      result.sent += 1;
    } else {
      result.failed += 1;
      result.failures.push({ notificationId: id, error: outcome.error });
    }
  }

  return result;
}
