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
