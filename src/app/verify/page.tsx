import { redirect } from "next/navigation";
import { auth } from "../../auth.js";
import { hasAccessRole } from "../../auth/authz.js";
import { AppShell } from "../components/app-shell.js";

export default async function VerifyLandingPage() {
  const session = await auth();

  if (!session) {
    return (
      <AppShell session={null}>
        <div className="container">
          <div className="state-card state-card-neutral">
            <p style={{ margin: 0 }}>
              <a href="/">Sign in</a> first.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!hasAccessRole(session, "auditor") && !hasAccessRole(session, "admin")) {
    return (
      <AppShell session={session}>
        <div className="container">
          <div className="state-card state-card-warning">
            <p style={{ margin: 0 }}>Requires the Auditor or Admin role.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell session={session}>
      <div className="container">
        <h1>Verify an Approval Code</h1>
        <p className="helptext">
          Look up any brief by its Approval Code — the audit entry point, available
          without needing to know who submitted it.
        </p>
        <form
          action={async (formData: FormData) => {
            "use server";
            const code = formData.get("code");
            if (typeof code === "string" && code.trim()) {
              redirect(`/verify/${encodeURIComponent(code.trim())}`);
            }
          }}
          className="card"
          style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end" }}
        >
          <div style={{ flex: 1 }}>
            <label htmlFor="code">Approval Code</label>
            <input
              id="code"
              name="code"
              placeholder="FC-2609-4X7K2-B"
              style={{ fontFamily: "var(--font-mono)" }}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Look up
          </button>
        </form>
      </div>
    </AppShell>
  );
}
