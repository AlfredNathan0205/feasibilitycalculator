/**
 * Thin wrapper around Resend's send-email endpoint (raw fetch, not the
 * `resend` npm package — this is a single POST call, so a new dependency
 * isn't warranted for it).
 *
 * ⚠️ NOT VERIFIED IN THIS SANDBOX: this sandbox's network egress allowlist
 * does not include api.resend.com, so this function's actual HTTP call has
 * never been run here — same honest limitation as the Playwright suite
 * (see docs/backlog.md). It's built strictly to Resend's documented API
 * shape (POST https://api.resend.com/emails, Bearer auth, {from, to,
 * subject, html, text}), and dispatch-notifications.ts's logic around it
 * is verified against real Postgres with a stub sender — but the request
 * against Resend's real API needs a first real run outside this sandbox
 * (e.g. via `curl` or the deployed app itself) before it's trusted, the
 * same way the e2e suite needs a first real run.
 */

export class ResendSendError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ResendSendError";
  }
}

export interface ResendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmailViaResend(input: ResendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATIONS_FROM_EMAIL;

  if (!apiKey) throw new ResendSendError("RESEND_API_KEY is not set");
  if (!from) throw new ResendSendError("NOTIFICATIONS_FROM_EMAIL is not set");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      // ignore — best-effort detail only
    }
    throw new ResendSendError(
      `Resend API responded ${response.status}${detail ? `: ${detail}` : ""}`,
      response.status,
    );
  }
}
