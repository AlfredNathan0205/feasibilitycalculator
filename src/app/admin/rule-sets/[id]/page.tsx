import { eq } from "drizzle-orm";
import { auth } from "../../../../auth.js";
import * as schema from "../../../../db/schema.js";
import { hasAccessRole } from "../../../../auth/authz.js";
import { AppShell } from "../../../components/app-shell.js";
import { RuleSetEditor } from "./editor.js";
import { getDb } from "../../../../lib/db.js";

export default async function RuleSetEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();

  if (!session) {
    return (
      <AppShell session={null}>
        <div className="container">
          <p style={{ marginTop: "3rem" }}>
            <a href="/">Sign in</a> first.
          </p>
        </div>
      </AppShell>
    );
  }
  if (!hasAccessRole(session, "admin")) {
    return (
      <AppShell session={session}>
        <div className="container">
          <div className="card" style={{ marginTop: "3rem" }}>
            <p style={{ margin: 0 }}>Requires the Admin role.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const db = getDb();
  const [ruleSet] = await db
    .select()
    .from(schema.ruleSets)
    .where(eq(schema.ruleSets.id, id));
  if (!ruleSet) {
    return (
      <AppShell session={session}>
        <div className="container">
          <div className="card" style={{ marginTop: "3rem" }}>
            <p style={{ margin: 0 }}>No rule set with that id.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell session={session}>
      <div className="container-wide">
        <h1>
          Rule set v{ruleSet.version}{" "}
          <span className="helptext" style={{ fontWeight: 400 }}>
            ({ruleSet.status})
          </span>
        </h1>
        <RuleSetEditor
          ruleSetId={ruleSet.id}
          status={ruleSet.status}
          initialPayload={ruleSet.payload as never}
        />
      </div>
    </AppShell>
  );
}
