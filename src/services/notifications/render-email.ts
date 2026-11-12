/**
 * Pure rendering of the email templates the outbox queues
 * (see create-brief.ts, decide-requirement.ts and veto.ts). Deliberately has no
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
  niche_growth_partner: "Niche growth partner approval",
  niche_development_route: "Niche development route approval",
  niche_charging_model: "Niche charging model approval",
};

const NICHE_BAND_NAMES: Record<string, string> = {
  strategic_partner: "Niche Tier 1 · Strategic Partner",
  growth_partner: "Niche Tier 2 · Growth Partner",
  development_opportunity: "Development Opportunity",
  charge_or_decline: "Charge or Decline",
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

    case "brief_vetoed": {
      const customerReference =
        typeof payload.customerReference === "string" ? payload.customerReference : "—";
      const reason = typeof payload.reason === "string" ? payload.reason : "";
      const subject = `Brief vetoed — ${customerReference}`;
      const text = [
        `Brief ${customerReference} has been vetoed by the General Manager and is now declined.`,
        reason ? `Reason: "${reason}"` : null,
        `An Admin can reverse a veto if it was made in error.`,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
      const html = `
        <p>Brief <strong>${escapeHtml(customerReference)}</strong> has been vetoed by the
        General Manager and is now declined.</p>
        ${reason ? `<p>Reason: &ldquo;${escapeHtml(reason)}&rdquo;</p>` : ""}
        <p>An Admin can reverse a veto if it was made in error.</p>
      `.trim();
      return { subject, html, text };
    }

    case "veto_reversed": {
      const customerReference =
        typeof payload.customerReference === "string" ? payload.customerReference : "—";
      const subject = `Veto reversed — ${customerReference}`;
      const text = `The veto on brief ${customerReference} has been reversed by an Admin. The vetoed requirement is back in the approver queue.`;
      const html = `<p>The veto on brief <strong>${escapeHtml(
        customerReference,
      )}</strong> has been reversed by an Admin. The vetoed requirement is back in the approver queue.</p>`;
      return { subject, html, text };
    }

    case "approval_requested": {
      const customerReference =
        typeof payload.customerReference === "string" ? payload.customerReference : "—";
      const types = Array.isArray(payload.requirementTypes)
        ? payload.requirementTypes.map((t) => requirementLabel(t))
        : [];
      const deadline =
        typeof payload.deadline === "string" && payload.deadline
          ? payload.deadline
          : null;
      const url = `${base}/approvals`;
      const subject = `Sign-off needed — ${customerReference}`;
      const text = [
        `Brief ${customerReference} needs your sign-off:`,
        ...types.map((t) => `  - ${t}`),
        deadline ? `Customer deadline: ${deadline}` : null,
        ``,
        `Open your approvals: ${url}`,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
      const html = `
        <p>Brief <strong>${escapeHtml(customerReference)}</strong> needs your sign-off:</p>
        <ul>${types.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
        ${deadline ? `<p>Customer deadline: <strong>${escapeHtml(deadline)}</strong></p>` : ""}
        <p><a href="${escapeHtml(url)}">Open your approvals</a></p>
      `.trim();
      return { subject, html, text };
    }

    case "brief_approved": {
      const customerReference =
        typeof payload.customerReference === "string" ? payload.customerReference : "—";
      const code = typeof payload.approvalCode === "string" ? payload.approvalCode : "";
      const briefId = typeof payload.briefId === "string" ? payload.briefId : "";
      const url = `${base}/briefs/${encodeURIComponent(briefId)}`;
      const subject = `Brief approved — ${customerReference}`;
      const text = [
        `Brief ${customerReference} has all the sign-offs it needs and is approved.`,
        code ? `Approval Code: ${code}` : null,
        ``,
        `View the brief: ${url}`,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
      const html = `
        <p>Brief <strong>${escapeHtml(customerReference)}</strong> has all the sign-offs it
        needs and is approved.</p>
        ${code ? `<p>Approval Code: <strong>${escapeHtml(code)}</strong></p>` : ""}
        <p><a href="${escapeHtml(url)}">View the brief</a></p>
      `.trim();
      return { subject, html, text };
    }

    case "requirement_rejected": {
      const customerReference =
        typeof payload.customerReference === "string" ? payload.customerReference : "—";
      const requirementType = requirementLabel(payload.requirementType);
      const comment = typeof payload.comment === "string" ? payload.comment : "";
      const briefId = typeof payload.briefId === "string" ? payload.briefId : "";
      const url = `${base}/briefs/${encodeURIComponent(briefId)}`;
      const subject = `Sign-off rejected — ${customerReference}`;
      const text = [
        `The ${requirementType} sign-off on brief ${customerReference} was rejected.`,
        comment ? `Comment: "${comment}"` : null,
        `The brief will not receive an Approval Code unless that sign-off is cleared.`,
        ``,
        `View the brief: ${url}`,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
      const html = `
        <p>The <strong>${escapeHtml(requirementType)}</strong> sign-off on brief
        <strong>${escapeHtml(customerReference)}</strong> was rejected.</p>
        ${comment ? `<p>Comment: &ldquo;${escapeHtml(comment)}&rdquo;</p>` : ""}
        <p>The brief will not receive an Approval Code unless that sign-off is cleared.</p>
        <p><a href="${escapeHtml(url)}">View the brief</a></p>
      `.trim();
      return { subject, html, text };
    }

    case "niche_assessment_review_request":
    case "niche_assessment_outcome":
    case "niche_assessment_expiring": {
      const str = (v: unknown, d = "—") => (typeof v === "string" && v ? v : d);
      const reference = str(payload.reference);
      const brandName = str(payload.brandName);
      const id = typeof payload.assessmentId === "string" ? payload.assessmentId : "";
      const url = `${base}/niche/assessments/${encodeURIComponent(id)}`;
      const band =
        typeof payload.band === "string"
          ? (NICHE_BAND_NAMES[payload.band] ?? payload.band)
          : null;
      const score = typeof payload.score === "number" ? payload.score : null;
      const result = band
        ? `${band}${score !== null ? `, score ${score}/100` : ""}`
        : null;
      let subject: string;
      let lines: string[];
      if (template === "niche_assessment_review_request") {
        subject = `Niche assessment to review — ${brandName}`;
        lines = [
          `A Niche Brand Assessment (${reference}) for ${brandName} is waiting for your review.`,
          result ? `Outcome: ${result}` : "",
          payload.escalated === true
            ? "You are asked because the normal reviewer is the assessor."
            : "",
        ];
      } else if (template === "niche_assessment_outcome") {
        const approved = payload.decision === "approved";
        subject = `Niche assessment ${approved ? "approved" : "rejected"} — ${brandName}`;
        const comment = str(payload.comment, "");
        lines = [
          `Your Niche Brand Assessment (${reference}) for ${brandName} was ${approved ? "approved" : "rejected"}.`,
          result ? `Outcome: ${result}` : "",
          approved && typeof payload.validUntil === "string"
            ? `Valid until ${payload.validUntil}.`
            : "",
          comment ? `Reviewer comment: "${comment}"` : "",
        ];
      } else {
        subject = `Niche assessment expiring — ${brandName}`;
        lines = [
          `The Niche Brand Assessment (${reference}) for ${brandName} expires on ${str(payload.validUntil)}.`,
          "After that, briefs for this brand are scored as standard briefs until a new assessment is approved.",
        ];
      }
      const kept = lines.filter(Boolean);
      const text = [...kept, "", `Open the assessment: ${url}`].join("\n");
      const html = `${kept.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}<p><a href="${escapeHtml(url)}">Open the assessment</a></p>`;
      return { subject, html, text };
    }

    default:
      throw new UnknownNotificationTemplateError(template);
  }
}
