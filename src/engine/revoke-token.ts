/**
 * Revoke token — Build Prompt §5 Stage C: "a revoke link, valid for a
 * configurable window (default 72 hours), signed and single-use."
 *
 * The security model is possession of the raw token (like a password-reset
 * link), not a session — the nominated manager clicks an emailed link and
 * doesn't need to be signed in. Only the HASH is ever stored
 * (`approval_requirements.revoke_token_hash`); the raw token exists only
 * in the URL sent by email and is never persisted, so a database leak
 * alone can't be used to forge a revoke.
 *
 * "Single-use" is enforced by the caller (decide-requirement's revoke
 * path) clearing `revoke_token_hash` to NULL once used — this module only
 * handles generating and verifying the token itself, not the single-use
 * bookkeeping, which belongs with the rest of the requirement's state
 * transition.
 */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

export interface RevokeToken {
  /** The raw token — goes in the emailed URL, never stored. */
  rawToken: string;
  /** SHA-256 hex digest — what actually gets stored in the DB. */
  hash: string;
  expiresAt: Date;
}

const DEFAULT_REVOKE_WINDOW_HOURS = 72;

export function generateRevokeToken(
  now: Date = new Date(),
  windowHours: number = DEFAULT_REVOKE_WINDOW_HOURS,
): RevokeToken {
  const rawToken = randomBytes(32).toString("hex");
  const hash = hashRevokeToken(rawToken);
  const expiresAt = new Date(now.getTime() + windowHours * 60 * 60 * 1000);
  return { rawToken, hash, expiresAt };
}

export function hashRevokeToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Constant-time comparison — this is a security-relevant check (anyone
 * who can guess/brute-force it can revoke an approval), so it uses
 * timingSafeEqual rather than `===`, unlike the Approval Code's check
 * character (which only needs to catch typos, not resist an attacker).
 */
export function verifyRevokeToken(rawToken: string, storedHash: string): boolean {
  const candidateHash = hashRevokeToken(rawToken);
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
