import { auth } from "../../auth.js";
import { canViewNiche } from "../../auth/authz.js";
import { AppShell } from "../components/app-shell.js";

/** auth() is overloaded (it doubles as middleware); calling it gives the session type. */
export async function currentSession() {
  return await auth();
}
export type Session = NonNullable<Awaited<ReturnType<typeof currentSession>>>;

/** Sign-in and view-permission gate shared by every niche page. */
export async function nicheGate(): Promise<
  { ok: true; session: Session } | { ok: false; view: React.ReactNode }
> {
  const session = await currentSession();
  if (!session) {
    return {
      ok: false,
      view: (
        <AppShell session={null}>
          <div className="container">
            <p style={{ marginTop: "3rem" }}>
              <a href="/">Sign in</a> first.
            </p>
          </div>
        </AppShell>
      ),
    };
  }
  if (!canViewNiche(session)) {
    return {
      ok: false,
      view: (
        <AppShell session={session}>
          <div className="container">
            <div className="card" style={{ marginTop: "3rem" }}>
              <p style={{ margin: 0 }}>
                Niche brand assessments are visible to Account Managers, Sales
                Coordinators, the Commercial Director, Auditors and Admins.
              </p>
            </div>
          </div>
        </AppShell>
      ),
    };
  }
  return { ok: true, session };
}

export function Notice({ ok, error }: { ok?: string; error?: string }) {
  return (
    <>
      {ok && (
        <div className="card" role="status" style={{ marginBottom: "1rem" }}>
          {ok}
        </div>
      )}
      {error && (
        <div
          className="card"
          role="alert"
          style={{ marginBottom: "1rem", borderColor: "#c0392b" }}
        >
          {error}
        </div>
      )}
    </>
  );
}

export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB") : "—";
