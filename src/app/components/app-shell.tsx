import Image from "next/image";
import { signOut } from "../../auth.js";
import { NavLink } from "./nav-link.js";

export function AppShell({
  session,
  children,
}: {
  session: {
    user?: { name?: string | null; email?: string | null };
    accessRoles: string[];
    approvalAuthorityRoles?: string[];
  } | null;
  children: React.ReactNode;
}) {
  if (!session) {
    return <>{children}</>;
  }

  const displayName = session.user?.name ?? session.user?.email ?? "User";
  const cleanName = displayName.replace(/\s*\([^)]*\)\s*$/, "");
  const initials = cleanName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const roleLabel = session.accessRoles.map((r) => r.replace(/_/g, " ")).join(", ");

  return (
    <div className="shell-layout">
      <aside className="shell-sidebar">
        <div>
          <a href="/" className="shell-brand">
            <Image
              src="/cpl-logo-muted.png"
              alt=""
              width={34}
              height={34}
              className="shell-brand-logo"
              priority
            />
            <span className="shell-brand-text">
              <span className="shell-brand-name">Feasibility Calculator</span>
              <span className="shell-brand-sub">CPL Aromas</span>
            </span>
          </a>

          <nav className="shell-nav">
            <NavLink href="/briefs" icon="briefs">
              Briefs
            </NavLink>
            {(session.accessRoles.includes("account_manager") ||
              session.accessRoles.includes("sales_coordinator")) && (
              <NavLink href="/briefs/new" icon="new">
                New brief
              </NavLink>
            )}
            {(session.accessRoles.includes("account_manager") ||
              session.accessRoles.includes("sales_coordinator") ||
              session.accessRoles.includes("auditor") ||
              session.accessRoles.includes("admin") ||
              (session.accessRoles.includes("approver") &&
                session.approvalAuthorityRoles?.includes("commercial_director"))) && (
              <NavLink href="/niche" icon="niche">
                Niche brands
              </NavLink>
            )}
            {(session.accessRoles.includes("approver") ||
              session.accessRoles.includes("admin")) && (
              <NavLink href="/approvals" icon="approvals">
                Approvals
              </NavLink>
            )}
            {(session.accessRoles.includes("admin") ||
              session.accessRoles.includes("auditor") ||
              (session.accessRoles.includes("approver") &&
                (session.approvalAuthorityRoles?.includes("general_manager") ||
                  session.approvalAuthorityRoles?.includes("commercial_director")))) && (
              <NavLink href="/dashboard" icon="dashboard">
                Dashboard
              </NavLink>
            )}
            {session.accessRoles.includes("admin") && (
              <NavLink href="/admin/rule-sets" icon="rules">
                Rule sets
              </NavLink>
            )}
            {session.accessRoles.includes("admin") && (
              <NavLink href="/admin/niche-frameworks" icon="frameworks">
                Niche frameworks
              </NavLink>
            )}
            {session.accessRoles.includes("admin") && (
              <NavLink href="/admin/people" icon="people">
                People and roles
              </NavLink>
            )}
            {(session.accessRoles.includes("auditor") ||
              session.accessRoles.includes("admin")) && (
              <NavLink href="/verify" icon="verify">
                Verify a code
              </NavLink>
            )}
          </nav>
        </div>

        <div className="shell-footer">
          <div className="shell-user">
            <span className="shell-avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="shell-user-text">
              <span className="shell-user-name">{cleanName}</span>
              <span className="shell-user-role">{roleLabel || "No role"}</span>
            </span>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button type="submit" className="shell-signout">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="shell-main">{children}</main>
    </div>
  );
}
