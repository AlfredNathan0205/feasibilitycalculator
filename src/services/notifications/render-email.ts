/**
 * Pure rendering of the two email templates the outbox currently queues
 * (see create-brief.ts and decide-requirement.ts). Deliberately has no
 * DB access and no network calls — dispatch-notifications.ts does the I/O
 * and hands this function whatever it already has in hand, which keeps
 * template wording/structure testable without Postgres or a real send.
 *
 * If a third template is ever queued without a case added here, this
 * throws rather than silently sending a blank email — the dispatch loop
 * catches that and marks the notification "failed" instead of "sent",
 * which is the correct behaviour (a bug in the sender should never look
 * like a successfully delivered notification).
 */

const REQUIREMENT_TYPE_LABELS: Record<string, string> = {
  short_deadline: "Short deadline",
  creative_creation: "Creative creation",
  creative_starting_point: "Creative starting point",
  marketing_resource: "Marketing resource sign-off",
  ppd_resource: "PPD resource sign-off",
  gcms_resource: "GCMS resource sign-off",
  tier_auto_approval: "Tier auto-approval",
  strategic_priority_deferral: "Strategic priority deferral",
};

function requirementLabel(requirementType: unknown): string {
  if (typeof requirementType === "string" && requirementType in REQUIREMENT_TYPE_LABELS) {
    return REQUIREMENT_TYPE_LABELS[requirementType]!;
  }
  return typeof requirementType === "string" ? requirementType : "requirement";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatWindow(iso: unknown): string {
  if (typeof iso !== "string") return "shortly";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "shortly";
  return date.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export class UnknownNotificationTemplateError extends Error {
  constructor(template: string) {
    super(`No email renderer registered for notification template "${template}"`);
    this.name = "UnknownNotificationTemplateError";
  }
}

/**
 * @param appBaseUrl Origin used to build absolute links (e.g. the revoke
 *   link) — emails can't use relative URLs. Pass NEXTAUTH_URL (the
 *   deployment's own URL, already used elsewhere in this project) with any
 *   trailing slash stripped.
 */
export function renderNotificationEmail(
  template: string,
  payload: Record<string, unknown>,
  appBaseUrl: string,
): RenderedEmail {
  const base = appBaseUrl.replace(/\/+$/, "");

  switch (template) {
    case "pre_approval_declared": {
      const requirementType = requirementLabel(payload.requirementType);
      const customerReference =
        typeof payload.customerReference === "string" ? payload.customerReference : "—";
      const submitterComment =
        typeof payload.submitterComment === "string" &&
        payload.submitterComment.trim().length > 0
          ? payload.submitterComment
          : null;
      const expiresLabel = formatWindow(payload.revokeWindowExpiresAt);
      const briefId = typeof payload.briefId === "string" ? payload.briefId : "";
      const rawRevokeToken =
        typeof payload.rawRevokeToken === "string" ? payload.rawRevokeToken : "";
      // Route is /revoke/[requirementId]/[token] — requirementId, not
      // briefId, is the path segment (see src/app/revoke/.../page.tsx).
      const requirementId =
        typeof payload.requirementId === "string" ? payload.requirementId : briefId;
      const revokeUrl = `${base}/revoke/${encodeURIComponent(requirementId)}/${encodeURIComponent(
        rawRevokeToken,
      )}`;

      const subject = `Pre-approval declared on your behalf — ${customerReference}`;
      const text = [
        `A pre-approval declaration was made on your behalf for a ${requirementType} requirement on brief ${customerReference}.`,
        submitterComment ? `Submitter's comment: "${submitterComment}"` : null,
        ``,
        `If this is not correct, you can revoke it before ${expiresLabel} using this link:`,
        revokeUrl,
        ``,
        `This link can only be used once. If you take no action, the pre-approval stands.`,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");

      const html = `
        <p>A pre-approval declaration was made on your behalf for a
        <strong>${escapeHtml(requirementType)}</strong> requirement on brief
        <strong>${escapeHtml(customerReference)}</strong>.</p>
        ${submitterComment ? `<p>Submitter's comment: &ldquo;${escapeHtml(submitterComment)}&rdquo;</p>` : ""}
        <p>If this is not correct, you can revoke it before <strong>${escapeHtml(
          expiresLabel,
        )}</strong> using the link below:</p>
        <p><a href="${escapeHtml(revokeUrl)}">${escapeHtml(revokeUrl)}</a></p>
        <p>This link can only be used once. If you take no action, the pre-approval stands.</p>
      `.trim();

      return { subject, html, text };
    }

    case "pre_approval_revoked": {
      const requirementType = requirementLabel(payload.requirementType);
      const customerReference =
        typeof payload.customerReference === "string" ? payload.customerReference : "—";

      const subject = `Pre-approval revoked — ${customerReference}`;
      const text = [
        `The pre-approval declared for a ${requirementType} requirement on brief ${customerReference} has been revoked by the nominated manager.`,
        `The requirement is back with the approver queue and the brief no longer has an Approval Code until it clears again.`,
      ].join("\n");
      const html = `
        <p>The pre-approval declared for a <strong>${escapeHtml(
          requirementType,
        )}</strong> requirement on brief <strong>${escapeHtml(
          customerReference,
        )}</strong> has been revoked by the nominated manager.</p>
        <p>The requirement is back with the approver queue and the brief no longer has an
        Approval Code until it clears again.</p>
      `.trim();

      return { subject, html, text };
    }

    default:
      throw new UnknownNotificationTemplateError(template);
  }
}
