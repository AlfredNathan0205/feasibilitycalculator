import { redirect } from "next/navigation";
import { auth } from "../../../auth.js";
import { hasAccessRole } from "../../../auth/authz.js";
import { getDb } from "../../../lib/db.js";
import {
  PeopleAdminError,
  addPerson,
  assignRole,
  endRole,
  listPeople,
  listRoleDefinitions,
  setPersonActive,
} from "../../../services/people-admin.js";
import { AppShell } from "../../components/app-shell.js";

/** Runs an Admin-only mutation and bounces back with a message either way. */
async function run(op: (actorId: string) => Promise<string>) {
  const session = await auth();
  if (!session || !hasAccessRole(session, "admin"))
    redirect("/admin/people?error=Requires+the+Admin+role.");
  let target: string;
  try {
    target = `/admin/people?ok=${encodeURIComponent(await op(session.userId))}`;
  } catch (e) {
    if (!(e instanceof PeopleAdminError)) throw e;
    target = `/admin/people?error=${encodeURIComponent(e.message)}`;
  }
  redirect(target);
}

async function addPersonAction(formData: FormData) {
  "use server";
  await run(async (actor) => {
    await addPerson(getDb(), actor, {
      upn: String(formData.get("upn") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
    });
    return "Person added. Give them a role below.";
  });
}
async function assignRoleAction(formData: FormData) {
  "use server";
  await run(async (actor) => {
    const roleKey = String(formData.get("roleKey") ?? "");
    if (!roleKey) throw new PeopleAdminError("Choose a role to add.");
    await assignRole(getDb(), actor, { userId: String(formData.get("userId")), roleKey });
    return "Role added.";
  });
}
async function endRoleAction(formData: FormData) {
  "use server";
  await run(async (actor) => {
    await endRole(getDb(), actor, {
      userId: String(formData.get("userId")),
      roleKey: String(formData.get("roleKey")),
    });
    return "Role ended.";
  });
}
async function setActiveAction(formData: FormData) {
  "use server";
  await run(async (actor) => {
    const active = formData.get("active") === "true";
    await setPersonActive(getDb(), actor, {
      userId: String(formData.get("userId")),
      active,
    });
    return active ? "Person reactivated." : "Person deactivated.";
  });
}

export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
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

  const { ok, error } = await searchParams;
  const db = getDb();
  const [people, roles] = await Promise.all([listPeople(db), listRoleDefinitions(db)]);
  const roleName = Object.fromEntries(roles.map((r) => [r.key, r.displayName]));

  return (
    <AppShell session={session}>
      <div className="container-wide">
        <div className="eyebrow">ADMIN</div>
        <div className="page-header">
          <h1>People and roles</h1>
        </div>
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

        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <form
            action={addPersonAction}
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              alignItems: "end",
            }}
          >
            <div>
              <label htmlFor="displayName">Name</label>
              <input id="displayName" name="displayName" required />
            </div>
            <div>
              <label htmlFor="upn">Work email (Microsoft sign-in)</label>
              <input
                id="upn"
                name="upn"
                type="email"
                required
                style={{ minWidth: "18rem" }}
              />
            </div>
            <button type="submit" className="btn btn-primary">
              Add person
            </button>
          </form>
          <p style={{ color: "var(--cpl-ink-soft)", marginBottom: 0 }}>
            A new person has no access until you give them a role. Role changes apply the
            next time that person signs in.
          </p>
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="data-table data-table-flush">
            <thead>
              <tr>
                {["Person", "Roles", "Add a role", "Status"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const available = roles.filter((r) => !p.roles.includes(r.key));
                return (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.displayName}</strong>
                      <div style={{ color: "var(--cpl-ink-soft)" }}>{p.upn}</div>
                      {!p.signedInBefore && (
                        <div style={{ color: "var(--cpl-ink-soft)" }}>
                          Has not signed in yet
                        </div>
                      )}
                    </td>
                    <td>
                      {p.roles.length === 0 && (
                        <span style={{ color: "var(--cpl-ink-soft)" }}>No roles</span>
                      )}
                      {p.roles.map((r) => (
                        <form
                          key={r}
                          action={endRoleAction}
                          style={{ display: "inline-block", marginRight: "0.4rem" }}
                        >
                          <input type="hidden" name="userId" value={p.id} />
                          <input type="hidden" name="roleKey" value={r} />
                          <span className="status-pill status-pending">
                            {roleName[r] ?? r}{" "}
                            <button
                              type="submit"
                              aria-label={`End ${roleName[r] ?? r} for ${p.displayName}`}
                              title="End this role"
                              style={{
                                background: "none",
                                border: 0,
                                cursor: "pointer",
                                padding: 0,
                              }}
                            >
                              ×
                            </button>
                          </span>
                        </form>
                      ))}
                    </td>
                    <td>
                      <form
                        action={assignRoleAction}
                        style={{ display: "flex", gap: "0.4rem" }}
                      >
                        <input type="hidden" name="userId" value={p.id} />
                        <select
                          name="roleKey"
                          aria-label={`Role to add for ${p.displayName}`}
                          defaultValue=""
                        >
                          <option value="">Choose…</option>
                          {available.map((r) => (
                            <option key={r.key} value={r.key}>
                              {r.displayName}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="btn">
                          Add
                        </button>
                      </form>
                    </td>
                    <td>
                      <form action={setActiveAction}>
                        <input type="hidden" name="userId" value={p.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={p.active ? "false" : "true"}
                        />
                        <span style={{ marginRight: "0.5rem" }}>
                          {p.active ? "Active" : "Deactivated"}
                        </span>
                        <button type="submit" className="btn">
                          {p.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
