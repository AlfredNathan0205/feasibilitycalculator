import { describe, expect, it } from "vitest";
import {
  renderNotificationEmail,
  UnknownNotificationTemplateError,
} from "./render-email.js";

describe("renderNotificationEmail", () => {
  it("renders pre_approval_declared with a working revoke link and the submitter's comment", () => {
    const result = renderNotificationEmail(
      "pre_approval_declared",
      {
        briefId: "brief-1",
        requirementId: "req-1",
        customerReference: "ACME-001",
        requirementType: "ppd_resource",
        submitterComment: "Cleared verbally with PPD last week",
        rawRevokeToken: "abc123XYZ",
        revokeWindowExpiresAt: "2027-01-15T10:00:00.000Z",
      },
      "https://feasibilitycalculator.example.com/",
    );

    expect(result.subject).toContain("ACME-001");
    expect(result.text).toContain("PPD resource sign-off");
    expect(result.text).toContain("Cleared verbally with PPD last week");
    expect(result.text).toContain(
      "https://feasibilitycalculator.example.com/revoke/req-1/abc123XYZ",
    );
    expect(result.html).toContain(
      'href="https://feasibilitycalculator.example.com/revoke/req-1/abc123XYZ"',
    );
    // Trailing slash on the base URL must not produce a double slash.
    expect(result.text).not.toContain("//revoke");
  });

  it("omits the comment line entirely when no submitter comment was given", () => {
    const result = renderNotificationEmail(
      "pre_approval_declared",
      {
        briefId: "brief-1",
        requirementId: "req-1",
        customerReference: "ACME-002",
        requirementType: "gcms_resource",
        submitterComment: null,
        rawRevokeToken: "tok",
        revokeWindowExpiresAt: "2027-01-15T10:00:00.000Z",
      },
      "https://example.com",
    );

    expect(result.text).not.toContain("Submitter's comment");
    expect(result.html).not.toContain("Submitter's comment");
  });

  it("HTML-escapes untrusted fields (customer reference, comment) to prevent injection", () => {
    const result = renderNotificationEmail(
      "pre_approval_declared",
      {
        briefId: "brief-1",
        requirementId: "req-1",
        customerReference: "<img src=x onerror=alert(1)>",
        requirementType: "marketing_resource",
        submitterComment: "<script>alert(1)</script>",
        rawRevokeToken: "tok",
        revokeWindowExpiresAt: "2027-01-15T10:00:00.000Z",
      },
      "https://example.com",
    );

    expect(result.html).not.toContain("<img src=x");
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
  });

  it("renders pre_approval_revoked with the requirement type and customer reference", () => {
    const result = renderNotificationEmail(
      "pre_approval_revoked",
      {
        requirementId: "req-1",
        briefId: "brief-1",
        customerReference: "ACME-003",
        requirementType: "creative_creation",
      },
      "https://example.com",
    );

    expect(result.subject).toContain("ACME-003");
    expect(result.text).toContain("Creative creation");
    expect(result.text).toContain("revoked");
  });

  it("falls back gracefully when optional fields are missing", () => {
    const result = renderNotificationEmail(
      "pre_approval_revoked",
      { requirementId: "req-1", briefId: "brief-1" },
      "https://example.com",
    );

    expect(result.subject).toBeTruthy();
    expect(result.text).toContain("requirement");
  });

  it("throws a specific, catchable error for an unknown template rather than sending a blank email", () => {
    expect(() =>
      renderNotificationEmail("something_new", {}, "https://example.com"),
    ).toThrow(UnknownNotificationTemplateError);
  });
});

describe("veto emails", () => {
  it("renders brief_vetoed with the reason, escaped", () => {
    const e = renderNotificationEmail(
      "brief_vetoed",
      {
        customerReference: "ACME",
        reason: "<b>no</b>",
      } as never,
      "https://app.example",
    );
    expect(e.subject).toBe("Brief vetoed — ACME");
    expect(e.text).toContain('Reason: "<b>no</b>"');
    expect(e.html).toContain("&lt;b&gt;no&lt;/b&gt;");
  });
  it("renders veto_reversed", () => {
    expect(
      renderNotificationEmail(
        "veto_reversed",
        { customerReference: "ACME" } as never,
        "https://app.example",
      ).subject,
    ).toBe("Veto reversed — ACME");
  });
  it("renders approval_requested listing every sign-off with a link to Approvals", () => {
    const r = renderNotificationEmail(
      "approval_requested",
      {
        briefId: "b1",
        customerReference: "ACME-9",
        requirementTypes: ["ppd_resource", "short_deadline"],
        deadline: "2027-02-01",
      },
      "https://app.example.com/",
    );
    expect(r.subject).toBe("Sign-off needed — ACME-9");
    expect(r.text).toContain("PPD resource sign-off");
    expect(r.text).toContain("Short deadline");
    expect(r.text).toContain("2027-02-01");
    expect(r.text).toContain("https://app.example.com/approvals");
    expect(r.html).toContain('href="https://app.example.com/approvals"');
  });

  it("renders brief_approved with the Approval Code and a link to the brief", () => {
    const r = renderNotificationEmail(
      "brief_approved",
      { briefId: "b1", customerReference: "ACME-9", approvalCode: "FC-2609-4X7K2-B" },
      "https://app.example.com",
    );
    expect(r.subject).toBe("Brief approved — ACME-9");
    expect(r.text).toContain("FC-2609-4X7K2-B");
    expect(r.text).toContain("https://app.example.com/briefs/b1");
  });

  it("renders requirement_rejected with the comment, escaped in HTML", () => {
    const r = renderNotificationEmail(
      "requirement_rejected",
      {
        briefId: "b1",
        customerReference: "ACME-9",
        requirementType: "ppd_resource",
        comment: "No <capacity> before March",
      },
      "https://app.example.com",
    );
    expect(r.subject).toBe("Sign-off rejected — ACME-9");
    expect(r.text).toContain("No <capacity> before March");
    expect(r.html).toContain("No &lt;capacity&gt; before March");
    expect(r.html).not.toContain("<capacity>");
  });
});
