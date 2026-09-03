import { NextResponse } from "next/server";
import { auth } from "../../../auth.js";

/**
 * Deliberately trivial: proves that (a) a signed-in request carries a
 * server-resolved session with roles already attached, and (b) an
 * unauthenticated request is rejected. Every real data route in later
 * phases should follow this same shape — call auth(), then pass
 * session.accessRoles / session.approvalAuthorityRoles into the pure
 * functions in src/auth/authz.ts, never re-deriving roles from anything
 * the client sent.
 */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  return NextResponse.json({
    userId: session.userId,
    name: session.user?.name,
    email: session.user?.email,
    accessRoles: session.accessRoles,
    approvalAuthorityRoles: session.approvalAuthorityRoles,
  });
}
