import { describe, it, expect } from "vitest";
import {
  hasAccessRole,
  requireAccessRole,
  requireAdmin,
  canActOnRequirement,
  requireCanActOnRequirement,
  checkSelfApproval,
  requireCanDecideRequirement,
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
    expect(hasAccessRole(session({ accessRoles: ["account_manager"] }), "account_manager")).toBe(true);
  });

  it("rejects an unheld role", () => {
    expect(hasAccessRole(session({ accessRoles: ["account_manager"] }), "admin")).toBe(false);
  });

  it("requireAccessRole throws AuthorizationError when missing", () => {
    expect(() => requireAccessRole(session(), "admin")).toThrow(AuthorizationError);
  });

  it("requireAccessRole does not throw when held", () => {
    expect(() => requireAccessRole(session({ accessRoles: ["admin"] }), "admin")).not.toThrow();
  });
});

describe("requireAdmin — §2 'editing thresholds requires Admin, deliberately narrow'", () => {
  it("blocks every other access role from admin actions", () => {
    for (const role of ["account_manager", "sales_coordinator", "approver", "auditor"]) {
      expect(() => requireAdmin(session({ accessRoles: [role] }))).toThrow(AuthorizationError);
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
        session({ accessRoles: ["approver"], approvalAuthorityRoles: ["analytical_manager"] }),
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
    expect(canActOnRequirement(ppdManager, { requiredRoleKey: "analytical_manager" })).toBe(false);
    expect(canActOnRequirement(ppdManager, { requiredRoleKey: "ppd_manager" })).toBe(true);
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

  it("the self-approval block error names the reassignment gap rather than silently guessing", () => {
    try {
      requireCanDecideRequirement(
        approverSession,
        { submittedBy: "approver-1", onBehalfOf: null },
        requirement,
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationError);
      expect((err as Error).message).toMatch(/line manager/);
      expect((err as Error).message).toMatch(/open-questions/);
    }
  });
});
