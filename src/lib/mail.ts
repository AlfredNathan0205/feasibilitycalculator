/**
 * Chooses the outgoing email provider from the environment.
 *   EMAIL_PROVIDER=graph | resend   — explicit choice, wins if set.
 *   otherwise: Microsoft Graph if all GRAPH_* variables are present,
 *   else Resend (the Vercel/test deployment's provider).
 * Throws a clear error rather than silently sending nothing.
 */
import type { SendEmailFn } from "../services/notifications/dispatch-notifications.js";
import { createGraphSender, graphConfigFromEnv } from "./graph-mail.js";
import { sendEmailViaResend } from "./resend.js";

export function getEmailSender(
  env: Record<string, string | undefined> = process.env,
): SendEmailFn {
  const explicit = env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (explicit && explicit !== "graph" && explicit !== "resend") {
    throw new Error(`EMAIL_PROVIDER must be "graph" or "resend", got "${explicit}"`);
  }
  const graph = graphConfigFromEnv(env);
  if (explicit === "graph" || (!explicit && graph)) {
    if (!graph) {
      throw new Error(
        "EMAIL_PROVIDER=graph needs GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET and GRAPH_SENDER",
      );
    }
    return createGraphSender(graph);
  }
  return sendEmailViaResend;
}
