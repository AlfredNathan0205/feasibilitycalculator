import { describe, it, expect } from "vitest";
import {
  hasAccessRole,
  requireAccessRole,
  requireAdmin,
  canActOnRequirement,
  requireCanActOnRequirement,
  checkSelfApproval,
  requireCanDecideRequirement,
  shouldEscalateRequirement,
  canViewDashboard,
  canViewNiche,
  canEditNiche,
  canManageNicheBrands,
  canManageNicheFrameworks,
  canReviewNicheAssessment,
  requireCanReviewNicheAssessment,
  AuthorizationError,
  type AuthSession,
} from "./authz.js";

function session(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    userId: "user-1",
    accessRoles: [],
    approvalAuthorityRoles: [],
    ...overrides,
  };
}

describe("hasAccessRole / requireAccessRole", () => {
  it("recognises a held role", () => {
    expect(
      hasAccessRole(session({ accessRoles: ["account_manager"] }), "account_manager"),
    ).toBe(true);
  });

  it("rejects an unheld role", () => {
    expect(hasAccessRole(session({ accessRoles: ["account_manager"] }), "admin")).toBe(
      false,
    );
  });

  it("requireAccessRole throws AuthorizationError when missing", () => {
    expect(() => requireAccessRole(session(), "admin")).toThrow(AuthorizationError);
  });

  it("requireAccessRole does not throw when held", () => {
    expect(() =>
      requireAccessRole(session({ accessRoles: ["admin"] }), "admin"),
    ).not.toThrow();
  });
});

describe("requireAdmin — §2 'editing thresholds requires Admin, deliberately narrow'", () => {
  it("blocks every other access role from admin actions", () => {
    for (const role of ["account_manager", "sales_coordinator", "approver", "auditor"]) {
      expect(() => requireAdmin(session({ accessRoles: [role] }))).toThrow(
        AuthorizationError,
      );
    }
  });

  it("allows admin", () => {
    expect(() => requireAdmin(session({ accessRoles: ["admin"] }))).not.toThrow();
  });
});

describe("canActOnRequirement — §2 'an approver may never approve a requirement not assigned to their role'", () => {
  it("requires BOTH the approver access role AND the specific approval-authority role", () => {
    const requirement = { requiredRoleKey: "ppd_manager" };

    // Has the specific authority role but not the general Approver access role.
    expect(
      canActOnRequirement(
        session({ accessRoles: [], approvalAuthorityRoles: ["ppd_manager"] }),
        requirement,
      ),
    ).toBe(false);

    // Has the general Approver access role but not this specific authority.
    expect(
      canActOnRequirement(
        session({
          accessRoles: ["approver"],
          approvalAuthorityRoles: ["analytical_manager"],
        }),
        requirement,
      ),
    ).toBe(false);

    // Has both — allowed.
    expect(
      canActOnRequirement(
        session({ accessRoles: ["approver"], approvalAuthorityRoles: ["ppd_manager"] }),
        requirement,
      ),
    ).toBe(true);
  });

  it("requireCanActOnRequirement throws with the requirement's role named in the message", () => {
    expect(() =>
      requireCanActOnRequirement(session({ accessRoles: ["approver"] }), {
        requiredRoleKey: "analytical_manager",
      }),
    ).toThrow(/analytical_manager/);
  });

  it("a PPD Manager cannot act on a GCMS requirement, and vice versa", () => {
    const ppdManager = session({
      accessRoles: ["approver"],
      approvalAuthorityRoles: ["ppd_manager"],
    });
    expect(
      canActOnRequirement(ppdManager, { requiredRoleKey: "analytical_manager" }),
    ).toBe(false);
    expect(canActOnRequirement(ppdManager, { requiredRoleKey: "ppd_manager" })).toBe(
      true,
    );
  });
});

describe("checkSelfApproval — §2 'may not approve a brief they themselves submitted'", () => {
  it("flags a conflict when the approver is the submitter", () => {
    const result = checkSelfApproval(session({ userId: "u1" }), {
      submittedBy: "u1",
      onBehalfOf: null,
    });
    expect(result).toEqual({ conflicted: true, reason: "submitter" });
  });

  it("flags a conflict when the approver is the Account Manager of record (on-behalf-of), even if a coordinator physically submitted it", () => {
    const result = checkSelfApproval(session({ userId: "am-1" }), {
      submittedBy: "coordinator-1",
      onBehalfOf: "am-1",
    });
    expect(result).toEqual({
      conflicted: true,
      reason: "on_behalf_of_account_manager",
    });
  });

  it("does not flag a conflict for an unrelated approver", () => {
    const result = checkSelfApproval(session({ userId: "approver-1" }), {
      submittedBy: "am-1",
      onBehalfOf: null,
    });
    expect(result).toEqual({ conflicted: false });
  });

  it("does not flag a conflict just because someone else submitted on behalf of a third party", () => {
    const result = checkSelfApproval(session({ userId: "approver-1" }), {
      submittedBy: "coordinator-1",
      onBehalfOf: "am-1",
    });
    expect(result).toEqual({ conflicted: false });
  });
});

describe("requireCanDecideRequirement — combined gate", () => {
  const requirement = { requiredRoleKey: "ppd_manager" };
  const approverSession = session({
    userId: "approver-1",
    accessRoles: ["approver"],
    approvalAuthorityRoles: ["ppd_manager"],
  });

  it("allows a properly-authorised approver acting on someone else's brief", () => {
    expect(() =>
      requireCanDecideRequirement(
        approverSession,
        { submittedBy: "am-1", onBehalfOf: null },
        requirement,
      ),
    ).not.toThrow();
  });

  it("blocks even a properly-authorised approver from deciding their own submitted brief", () => {
    expect(() =>
      requireCanDecideRequirement(
        approverSession,
        { submittedBy: "approver-1", onBehalfOf: null },
        requirement,
      ),
    ).toThrow(AuthorizationError);
  });

  it("blocks an approver who is the Account Manager of record even if someone else physically submitted", () => {
    expect(() =>
      requireCanDecideRequirement(
        approverSession,
        { submittedBy: "coordinator-1", onBehalfOf: "approver-1" },
        requirement,
      ),
    ).toThrow(AuthorizationError);
  });

  it("blocks someone without the specific approval-authority role regardless of self-approval status", () => {
    const wrongAuthority = session({
      userId: "someone-else",
      accessRoles: ["approver"],
      approvalAuthorityRoles: ["analytical_manager"], // not ppd_manager
    });
    expect(() =>
      requireCanDecideRequirement(
        wrongAuthority,
        { submittedBy: "am-1", onBehalfOf: null },
        requirement,
      ),
    ).toThrow(AuthorizationError);
  });

  it("the self-approval block error says why it was blocked", () => {
    try {
      requireCanDecideRequirement(
        approverSession,
        { submittedBy: "approver-1", onBehalfOf: null },
        requirement,
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationError);
      expect((err as Error).message).toMatch(/self-approval conflict \(submitter\)/);
    }
  });

  describe("escalated requirements are decided by an Admin", () => {
    const escalated = { requiredRoleKey: "ppd_manager", escalated: true };
    const admin = session({ userId: "admin-1", accessRoles: ["admin"] });
    const brief = { submittedBy: "approver-1", onBehalfOf: null };

    it("lets an Admin decide it, even without holding the approval role", () => {
      expect(() => requireCanDecideRequirement(admin, brief, escalated)).not.toThrow();
    });

    it("no longer lets the role's own approver decide it", () => {
      expect(() =>
        requireCanDecideRequirement(approverSession, brief, escalated),
      ).toThrow(AuthorizationError);
      const otherApprover = session({
        userId: "approver-2",
        accessRoles: ["approver"],
        approvalAuthorityRoles: ["ppd_manager"],
      });
      expect(() => requireCanDecideRequirement(otherApprover, brief, escalated)).toThrow(
        AuthorizationError,
      );
    });

    it("still blocks an Admin who submitted the brief, or is its Account Manager of record", () => {
      expect(() =>
        requireCanDecideRequirement(
          admin,
          { submittedBy: "admin-1", onBehalfOf: null },
          escalated,
        ),
      ).toThrow(/self-approval conflict/);
      expect(() =>
        requireCanDecideRequirement(
          admin,
          { submittedBy: "coordinator-1", onBehalfOf: "admin-1" },
          escalated,
        ),
      ).toThrow(/self-approval conflict/);
    });
  });
});

describe("shouldEscalateRequirement", () => {
  const brief = { submittedBy: "jo", onBehalfOf: null };

  it("escalates when the only holder is the submitter", () => {
    expect(shouldEscalateRequirement(["jo"], brief)).toBe(true);
  });

  it("escalates when the only holder is the Account Manager of record", () => {
    expect(
      shouldEscalateRequirement(["claire"], {
        submittedBy: "coordinator",
        onBehalfOf: "claire",
      }),
    ).toBe(true);
  });

  it("escalates when every holder is conflicted, across both identities", () => {
    expect(
      shouldEscalateRequirement(["coordinator", "claire"], {
        submittedBy: "coordinator",
        onBehalfOf: "claire",
      }),
    ).toBe(true);
  });

  it("does not escalate while any holder is unconflicted", () => {
    expect(shouldEscalateRequirement(["jo", "selena"], brief)).toBe(false);
  });

  it("does not escalate when there are no holders: that is a role-mapping gap, not a conflict", () => {
    expect(shouldEscalateRequirement([], brief)).toBe(false);
  });
});

describe("canViewDashboard", () => {
  it("allows the Commercial Director, who oversees sales", () => {
    expect(
      canViewDashboard(
        session({
          accessRoles: ["approver"],
          approvalAuthorityRoles: ["commercial_director"],
        }),
      ),
    ).toBe(true);
  });

  it("allows Admin, Auditor and the General Manager", () => {
    expect(canViewDashboard(session({ accessRoles: ["admin"] }))).toBe(true);
    expect(canViewDashboard(session({ accessRoles: ["auditor"] }))).toBe(true);
    expect(
      canViewDashboard(
        session({
          accessRoles: ["approver"],
          approvalAuthorityRoles: ["general_manager"],
        }),
      ),
    ).toBe(true);
  });

  it("refuses everyone else, including other approvers and Account Managers", () => {
    expect(
      canViewDashboard(
        session({
          accessRoles: ["approver"],
          approvalAuthorityRoles: ["ppd_manager"],
        }),
      ),
    ).toBe(false);
    expect(canViewDashboard(session({ accessRoles: ["account_manager"] }))).toBe(false);
    // The veto role alone, without the Approver access role, is not enough.
    expect(
      canViewDashboard(session({ approvalAuthorityRoles: ["general_manager"] })),
    ).toBe(false);
  });
});

describe("niche assessment permissions (spec §8)", () => {
  const s = (
    accessRoles: string[],
    approvalAuthorityRoles: string[] = [],
    userId = "u",
  ) => ({
    userId,
    accessRoles,
    approvalAuthorityRoles,
  });
  const reviewer = s(["approver"], ["commercial_director"], "rev");

  it("view: AM, SC, reviewer approver, Auditor, Admin only", () => {
    for (const role of ["account_manager", "sales_coordinator", "auditor", "admin"]) {
      expect(canViewNiche(s([role]))).toBe(true);
    }
    expect(canViewNiche(reviewer)).toBe(true);
    expect(canViewNiche(s(["approver"], ["ppd_manager"]))).toBe(false);
    expect(canViewNiche(s([]))).toBe(false);
  });
  it("create/edit brands and assessments: AM, SC, Admin; never Auditor or approver", () => {
    for (const role of ["account_manager", "sales_coordinator", "admin"]) {
      expect(canEditNiche(s([role]))).toBe(true);
    }
    expect(canEditNiche(s(["auditor"]))).toBe(false);
    expect(canEditNiche(reviewer)).toBe(false);
  });
  it("deactivate/merge brands and manage frameworks: Admin only", () => {
    expect(canManageNicheBrands(s(["admin"]))).toBe(true);
    expect(canManageNicheBrands(s(["account_manager"]))).toBe(false);
    expect(canManageNicheFrameworks(s(["admin"]))).toBe(true);
    expect(canManageNicheFrameworks(s(["auditor"]))).toBe(false);
    expect(canManageNicheFrameworks(reviewer)).toBe(false);
  });
  it("review: needs approver access plus the reviewer role, never the assessor", () => {
    const a = { assessorId: "am", escalated: false };
    expect(canReviewNicheAssessment(reviewer, a)).toBe(true);
    expect(canReviewNicheAssessment(s(["approver"], ["ppd_manager"]), a)).toBe(false);
    expect(canReviewNicheAssessment(s([], ["commercial_director"]), a)).toBe(false);
    expect(canReviewNicheAssessment(s(["admin"]), a)).toBe(false);
    expect(
      canReviewNicheAssessment(s(["approver"], ["commercial_director"], "am"), a),
    ).toBe(false);
    expect(canReviewNicheAssessment(s(["auditor"]), a)).toBe(false);
    expect(() => requireCanReviewNicheAssessment(s(["auditor"]), a)).toThrow(
      AuthorizationError,
    );
  });
  it("review when escalated: Admin only, still never the assessor", () => {
    const a = { assessorId: "am", escalated: true };
    expect(canReviewNicheAssessment(s(["admin"]), a)).toBe(true);
    expect(canReviewNicheAssessment(reviewer, a)).toBe(false);
    expect(canReviewNicheAssessment(s(["admin"], [], "am"), a)).toBe(false);
  });
  it("a different reviewer role key from the framework is honoured", () => {
    const a = { assessorId: "am", escalated: false };
    expect(
      canReviewNicheAssessment(
        s(["approver"], ["development_director"]),
        a,
        "development_director",
      ),
    ).toBe(true);
    expect(canReviewNicheAssessment(reviewer, a, "development_director")).toBe(false);
  });
});
