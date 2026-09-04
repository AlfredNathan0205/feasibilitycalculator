/**
 * Approval Code — Build Prompt §6.
 *
 * Format: FC-YYMM-XXXXX-C  (e.g. FC-2609-4X7K2-B)
 *   FC    — fixed prefix.
 *   YYMM  — 2-digit year + 2-digit month of issuance.
 *   XXXXX — 5 cryptographically random Crockford base32 characters.
 *   C     — a single check character over the whole preceding string, so a
 *           mistyped code fails fast rather than resolving to a different
 *           brief.
 *
 * Crockford base32 alphabet: digits 0-9 plus uppercase letters, EXCLUDING
 * I, L, O, U (to remove read-aloud/handwriting ambiguity) — 32 symbols
 * total. This is a pure module: no DB access, no randomness source beyond
 * Node's crypto, no I/O. The unique-constraint-and-regenerate-on-collision
 * behaviour the spec asks for lives in the caller (the brief-submission API
 * route), which retries generateApprovalCode() against the DB's unique
 * index — that's necessarily stateful, so it doesn't belong here.
 */

import { randomInt } from "node:crypto";

export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/* v8 ignore start -- self-check invariant on a hardcoded constant; can
 * only ever be false if someone edits CROCKFORD_ALPHABET itself, which
 * would need to happen before this module loads. Not a real runtime
 * branch reachable by any test input. */
if (CROCKFORD_ALPHABET.length !== 32) {
  throw new Error("CROCKFORD_ALPHABET must be exactly 32 characters");
}
/* v8 ignore stop */

const CHAR_VALUE = new Map<string, number>([...CROCKFORD_ALPHABET].map((c, i) => [c, i]));

// Crockford's own decoding-tolerance substitutions for characters that are
// easy to misread/mistype but aren't in the alphabet themselves.
const LOOKALIKE_SUBSTITUTIONS: Record<string, string> = {
  I: "1",
  L: "1",
  O: "0",
};

const PREFIX = "FC";
const PAYLOAD_LENGTH = PREFIX.length + 4 + 5; // "FC" + YYMM + XXXXX = 11
const FULL_LENGTH = PAYLOAD_LENGTH + 1; // + check char = 12

function randomCrockfordChar(): string {
  const index = randomInt(0, CROCKFORD_ALPHABET.length);
  return CROCKFORD_ALPHABET[index]!;
}

/**
 * Weighted checksum over the 11-character payload ("FC" + YYMM + XXXXX),
 * using distinct positional weights (1..11) so that both single-character
 * substitutions and adjacent transpositions are caught — a plain unweighted
 * sum would miss transpositions. Not cryptographic; it doesn't need to be —
 * its job is catching keying/reading mistakes, not resisting forgery.
 */
export function computeCheckChar(payload: string): string {
  if (payload.length !== PAYLOAD_LENGTH) {
    throw new Error(
      `computeCheckChar expects an ${PAYLOAD_LENGTH}-character payload, got ${payload.length}`,
    );
  }
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const value = CHAR_VALUE.get(payload[i]!);
    if (value === undefined) {
      throw new Error(
        `computeCheckChar: character "${payload[i]}" is not in the Crockford alphabet`,
      );
    }
    sum += value * (i + 1);
  }
  return CROCKFORD_ALPHABET[sum % CROCKFORD_ALPHABET.length]!;
}

/** Generates a brand-new code for the given issuance date (defaults to
 * now). Callers wanting a globally-unique code must check it against the
 * DB and regenerate on collision — see the module docstring. */
export function generateApprovalCode(issuedAt: Date = new Date()): string {
  const yy = String(issuedAt.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(issuedAt.getUTCMonth() + 1).padStart(2, "0");
  const random5 = Array.from({ length: 5 }, randomCrockfordChar).join("");
  const payload = `${PREFIX}${yy}${mm}${random5}`;
  const check = computeCheckChar(payload);
  return `${PREFIX}-${yy}${mm}-${random5}-${check}`;
}

/**
 * Normalizes free-typed user input into the canonical 12-character payload
 * (no dashes) per §6: "Case-insensitive and separator-insensitive on
 * lookup. Normalise input before checking: uppercase, strip anything that
 * is not an allowed character, apply Crockford's mapping of I/L to 1 and
 * O to 0."
 *
 * Returns null if, after normalization, the result isn't exactly 12
 * characters from the Crockford alphabet — i.e. structurally invalid,
 * not just "check character doesn't match" (that's verifyApprovalCode's
 * job, one level up).
 */
export function normalizeApprovalCodeInput(raw: string): string | null {
  const upper = raw.toUpperCase();
  let normalized = "";
  for (const char of upper) {
    if (CHAR_VALUE.has(char)) {
      normalized += char;
      continue;
    }
    const substitute = LOOKALIKE_SUBSTITUTIONS[char];
    if (substitute) {
      normalized += substitute;
      continue;
    }
    // Not a valid character and no look-alike mapping (dashes, spaces,
    // "U", punctuation, etc.) — strip it, per "strip anything that is not
    // an allowed character."
  }
  if (normalized.length !== FULL_LENGTH) return null;
  return normalized;
}

export interface ApprovalCodeVerification {
  valid: boolean;
  /** The canonical dashed form (FC-YYMM-XXXXX-C), present whenever
   * normalization succeeded structurally — even if the check character
   * turned out not to match, so callers can show the user what they typed
   * back in canonical form alongside the failure. */
  formatted?: string;
}

/**
 * Verifies a user-typed code: normalizes it, checks structural validity,
 * and recomputes the check character. This is the single source of truth
 * both the /verify/[code] page and the dashboard lookup box should call —
 * neither should re-implement normalization or checksum logic themselves.
 */
export function verifyApprovalCode(raw: string): ApprovalCodeVerification {
  const normalized = normalizeApprovalCodeInput(raw);
  if (!normalized) return { valid: false };

  const payload = normalized.slice(0, PAYLOAD_LENGTH);
  const providedCheck = normalized.slice(PAYLOAD_LENGTH);
  const expectedCheck = computeCheckChar(payload);

  const yy = payload.slice(2, 4);
  const mm = payload.slice(4, 6);
  const random5 = payload.slice(6);
  const formatted = `${PREFIX}-${yy}${mm}-${random5}-${providedCheck}`;

  if (!payload.startsWith(PREFIX)) return { valid: false, formatted };
  if (providedCheck !== expectedCheck) return { valid: false, formatted };
  return { valid: true, formatted };
}
