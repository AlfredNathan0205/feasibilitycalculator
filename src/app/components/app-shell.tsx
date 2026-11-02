import Image from "next/image";
import { signOut } from "../../auth.js";

export function AppShell({
  session,
  children,
}: {
  session: {
    user?: { name?: string | null; email?: string | null };
    accessRoles: string[];
  } | null;
  children: React.ReactNode;
}) {
  if (!session) {
    return <>{children}</>;
  }

  const displayName = session.user?.name ?? session.user?.email ?? "User";
  const roleLabel = session.accessRoles.map((r) => r.replace(/_/g, " ")).join(", ");

  return (
    <div className="shell-layout">
      <aside className="shell-sidebar">
        <div>
          <a href="/" className="shell-brand">
            <Image
              src="/cpl-logo-muted.png"
              alt="CPL Aromas"
              width={28}
              height={28}
              style={{ display: "block" }}
              priority
            />
            <div>
              <div className="shell-brand-eyebrow">CPL AROMAS</div>
              <div className="shell-brand-name">Feasibility Calculator</div>
            </div>
          </a>
          <div className="shell-brand-accent" />

          <nav className="shell-nav">
            <a href="/briefs" className="shell-nav-link">
              Briefs
            </a>
            {(session.accessRoles.includes("account_manager") ||
              session.accessRoles.includes("sales_coordinator")) && (
              <a href="/briefs/new" className="shell-nav-link">
                New brief
              </a>
            )}
            {(session.accessRoles.includes("approver") ||
              session.accessRoles.includes("admin")) && (
              <a href="/approvals" className="shell-nav-link">
                Approvals
              </a>
            )}
            {(session.accessRoles.includes("admin") ||
              session.accessRoles.includes("auditor")) && (
              <a href="/dashboard" className="shell-nav-link">
                Dashboard
              </a>
            )}
            {session.accessRoles.includes("admin") && (
              <a href="/admin/rule-sets" className="shell-nav-link">
                Rule sets
              </a>
            )}
            {session.accessRoles.includes("admin") && (
              <a href="/admin/people" className="shell-nav-link">
                People and roles
              </a>
            )}
            {(session.accessRoles.includes("auditor") ||
              session.accessRoles.includes("admin")) && (
              <a href="/verify" className="shell-nav-link">
                Verify a code
              </a>
            )}
          </nav>
        </div>

        <div className="shell-footer">
          <div className="shell-user-name">{displayName}</div>
          <div className="shell-user-role">{roleLabel || "No role"}</div>
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
