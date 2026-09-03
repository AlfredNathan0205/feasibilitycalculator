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
      <header
        style={{
          background: "var(--cpl-indigo)",
          color: "#fff",
        }}
      >
        <div
          style={{
            maxWidth: 1080,
            margin: "0 auto",
            padding: "0.75rem 1.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
          }}
        >
          <a
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.65rem",
              textDecoration: "none",
              color: "#fff",
            }}
          >
            <Image
              src="/cpl-logo.jpg"
              alt="CPL Aromas"
              width={34}
              height={34}
              style={{ borderRadius: 4, display: "block" }}
              priority
            />
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "1rem",
                letterSpacing: "-0.01em",
              }}
            >
              Project Feasibility
            </span>
          </a>

          {session && (
            <nav
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1.25rem",
                fontSize: "0.875rem",
              }}
            >
              <a href="/briefs/new" style={{ color: "#fff", opacity: 0.92 }}>
                New brief
              </a>
              {(session.accessRoles.includes("auditor") ||
                session.accessRoles.includes("admin")) && (
                <a href="/verify" style={{ color: "#fff", opacity: 0.92 }}>
                  Verify a code
                </a>
              )}
              <span style={{ opacity: 0.75 }}>
                {session.user?.name ?? session.user?.email}
              </span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button
                  type="submit"
                  style={{
                    background: "rgba(255,255,255,0.12)",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.3)",
                    borderRadius: 4,
                    padding: "0.4em 0.8em",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                  }}
                >
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
