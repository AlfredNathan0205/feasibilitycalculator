import { auth } from "../../../auth.js";
import { hasAccessRole } from "../../../auth/authz.js";
import { AppShell } from "../../components/app-shell.js";
import { BriefForm } from "./brief-form.js";

export default async function NewBriefPage() {
  const session = await auth();

  if (!session) {
    return (
      <AppShell session={null}>
        <div className="container">
          <p style={{ marginTop: "3rem" }}>
            <a href="/">Sign in</a> to submit a brief.
          </p>
        </div>
      </AppShell>
    );
  }

  if (
    !hasAccessRole(session, "account_manager") &&
    !hasAccessRole(session, "sales_coordinator")
  ) {
    return (
      <AppShell session={session}>
        <div className="container">
          <div className="card" style={{ marginTop: "3rem" }}>
            <p style={{ margin: 0 }}>
              Requires the Account Manager or Sales Coordinator role.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell session={session}>
      <div className="container">
        <h1 style={{ marginBottom: "1.5rem" }}>New brief</h1>
        <BriefForm />
      </div>
    </AppShell>
  );
}
