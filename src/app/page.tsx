import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { auth, signIn, signOut } from "../auth.js";
import * as schema from "../db/schema.js";

const devLoginEnabled = process.env.ALLOW_DEV_LOGIN === "true";

async function getTestUsers() {
  if (!process.env.DATABASE_URL) return [];
  const sql = postgres(process.env.DATABASE_URL);
  const db = drizzle(sql, { schema });
  const users = await db
    .select({
      upn: schema.users.upn,
      displayName: schema.users.displayName,
    })
    .from(schema.users)
    .where(eq(schema.users.active, true));
  await sql.end();
  return users;
}

export default async function Home() {
  const session = await auth();

  if (session) {
    return (
      <main>
        <h1>CPL Project Feasibility Calculator — dev auth smoke test</h1>
        <p>Signed in as <strong>{session.user?.name}</strong> ({session.user?.email})</p>
        <p><strong>userId:</strong> {session.userId}</p>
        <p><strong>Access roles:</strong> {session.accessRoles.join(", ") || "(none)"}</p>
        <p><strong>Approval-authority roles:</strong> {session.approvalAuthorityRoles.join(", ") || "(none)"}</p>
        <p>Try <a href="/api/whoami">/api/whoami</a> to see the same thing as JSON from a protected API route.</p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button type="submit">Sign out</button>
        </form>
      </main>
    );
  }

  if (!devLoginEnabled) {
    return (
      <main>
        <h1>CPL Project Feasibility Calculator</h1>
        <p>
          No sign-in method is configured. Set the AUTH_MICROSOFT_ENTRA_ID_*
          env vars for production, or ALLOW_DEV_LOGIN=true for local testing.
        </p>
      </main>
    );
  }

  const users = await getTestUsers();

  return (
    <main>
      <h1>CPL Project Feasibility Calculator — dev login</h1>
      <p style={{ background: "#fffae0", padding: "0.75rem", border: "1px solid #e0d080" }}>
        <strong>Local testing only.</strong> This dev login has no password and
        must never be enabled (ALLOW_DEV_LOGIN=true) in any deployed
        environment. Swap to Entra ID before deploying.
      </p>
      <form
        action={async (formData: FormData) => {
          "use server";
          const upn = formData.get("upn");
          await signIn("dev-login", {
            upn: typeof upn === "string" ? upn : "",
            redirectTo: "/",
          });
        }}
      >
        <label htmlFor="upn">Sign in as test user:</label>
        <select name="upn" id="upn">
          {users.map((u) => (
            <option key={u.upn} value={u.upn}>
              {u.displayName} ({u.upn})
            </option>
          ))}
        </select>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
