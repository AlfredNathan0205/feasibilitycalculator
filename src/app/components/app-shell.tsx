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
  return (
    <>
      <header className="shell-header">
        <div className="shell-header-inner">
          <a href="/" className="shell-brand">
            <Image
              src="/cpl-logo.jpg"
              alt="CPL Aromas"
              width={34}
              height={34}
              style={{ borderRadius: 4, display: "block" }}
              priority
            />
            <span className="shell-brand-name">Project Feasibility</span>
          </a>

          {session && (
            <nav className="shell-nav">
              <a href="/briefs/new" className="shell-nav-link">
                New brief
              </a>
              {session.accessRoles.includes("approver") && (
                <a href="/approvals" className="shell-nav-link">
                  Your approvals
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
              {(session.accessRoles.includes("auditor") ||
                session.accessRoles.includes("admin")) && (
                <a href="/verify" className="shell-nav-link">
                  Verify a code
                </a>
              )}
              <span className="shell-user">
                {session.user?.name ?? session.user?.email}
              </span>
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
            </nav>
          )}
        </div>
      </header>
      {children}
    </>
  );
}
