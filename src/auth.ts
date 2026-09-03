/**
 * NextAuth (Auth.js) v5 configuration.
 *
 * Two providers:
 *
 *  1. Microsoft Entra ID — the ONLY provider allowed in production (§2:
 *     "Microsoft Entra ID SSO only. No local accounts, no password
 *     storage."). Only registered when the three Entra env vars are
 *     present, so an incomplete/misconfigured deployment fails loudly
 *     (no provider registered => sign-in is unavailable) rather than
 *     silently falling back to something weaker.
 *
 *  2. A dev-only Credentials provider, for local testing before an Entra
 *     tenant exists. Registered ONLY when `ALLOW_DEV_LOGIN=true` is
 *     explicitly set — deliberately a separate flag from NODE_ENV, so a
 *     misconfigured production deployment that happens to run with
 *     NODE_ENV=development (e.g. a bad script) doesn't silently expose
 *     password-less login. There is no password: it's a list of the
 *     seeded test users to pick from, because local testing needs no
 *     stronger a barrier than "don't expose port 3000 to the internet."
 *
 * The jwt callback is the ONLY place role information enters the session —
 * it resolves roles from role_holders server-side via resolveSessionRoles()
 * and bakes them into the token. The client never supplies its own role
 * claim, and nothing in authz.ts trusts anything from the request body.
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "./db/schema.js";
import { resolveSessionRoles } from "./auth/resolve-session-roles.js";

const devLoginEnabled = process.env.ALLOW_DEV_LOGIN === "true";

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set");
  }
  const sql = postgres(databaseUrl);
  return drizzle(sql, { schema });
}

const providers = [];

if (
  process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
  process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
  process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER
) {
  providers.push(
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  );
}

if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Dev Login (local testing only — never enabled without ALLOW_DEV_LOGIN=true)",
      credentials: {
        upn: { label: "Test user UPN", type: "text" },
      },
      async authorize(credentials) {
        const upn = credentials?.upn;
        if (typeof upn !== "string" || upn.length === 0) return null;

        const db = getDb();
        const [user] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.upn, upn));

        if (!user || !user.active) return null;

        return {
          id: user.id,
          name: user.displayName,
          email: user.email,
        };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      // Only re-resolve roles on sign-in (when `user` is populated), not on
      // every subsequent request — avoids a DB round trip per request while
      // still never trusting a client-supplied claim (the resolution
      // itself only ever happens server-side, here).
      if (user?.id) {
        const db = getDb();
        const { accessRoles, approvalAuthorityRoles } =
          await resolveSessionRoles(db, user.id);
        token.userId = user.id;
        token.accessRoles = accessRoles;
        token.approvalAuthorityRoles = approvalAuthorityRoles;
      }
      return token;
    },
    async session({ session, token }) {
      session.userId = token.userId as string;
      session.accessRoles = (token.accessRoles as string[]) ?? [];
      session.approvalAuthorityRoles =
        (token.approvalAuthorityRoles as string[]) ?? [];
      return session;
    },
  },
});
