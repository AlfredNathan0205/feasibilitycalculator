import { NextResponse } from "next/server";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../../../db/schema.js";
import { dispatchQueuedNotifications } from "../../../../services/notifications/dispatch-notifications.js";
import { sendEmailViaResend } from "../../../../lib/resend.js";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set");
  return drizzle(postgres(databaseUrl), { schema });
}

/**
 * Not session-gated — there's no human sitting at a browser for a
 * scheduled job. Gated instead by CRON_SECRET, matching Vercel Cron
 * Jobs' documented convention of sending `Authorization: Bearer
 * $CRON_SECRET` on its own scheduled invocations when that env var is
 * set (see vercel.json's schedule for this route). Confirm this
 * convention against Vercel's current docs before relying on it in
 * production — this project's runbook flags it as unverified from this
 * sandbox, same as the Resend call itself.
 *
 * A manual trigger (e.g. from Claude Code, or an Admin's "send now"
 * button later) can call this the same way by sending the same header.
 */
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on this deployment" },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const appBaseUrl = process.env.NEXTAUTH_URL;
  if (!appBaseUrl) {
    return NextResponse.json(
      { error: "NEXTAUTH_URL is not configured on this deployment" },
      { status: 500 },
    );
  }

  const db = getDb();

  try {
    const result = await dispatchQueuedNotifications(db, sendEmailViaResend, {
      appBaseUrl,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Notification dispatch failed", err);
    return NextResponse.json(
      { error: "Internal error dispatching notifications" },
      { status: 500 },
    );
  }
}
