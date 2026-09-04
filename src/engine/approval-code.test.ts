import { describe, it, expect } from "vitest";
import {
  generateApprovalCode,
  verifyApprovalCode,
  normalizeApprovalCodeInput,
  computeCheckChar,
  CROCKFORD_ALPHABET,
} from "./approval-code.js";

describe("generateApprovalCode", () => {
  it("matches the FC-YYMM-XXXXX-C format", () => {
    const code = generateApprovalCode(new Date("2026-09-15T00:00:00Z"));
    expect(code).toMatch(/^FC-\d{4}-[0-9A-Z]{5}-[0-9A-Z]$/);
    expect(code.startsWith("FC-2609-")).toBe(true);
  });

  it("never uses I, L, O, or U anywhere in the random or check segments", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateApprovalCode();
      const parts = code.split("-");
      const random5 = parts[2] ?? "";
      const check = parts[3] ?? "";
      expect(random5 + check).not.toMatch(/[ILOU]/);
    }
  });

  it("generates a code that verifies as valid", () => {
    const code = generateApprovalCode(new Date("2026-01-01T00:00:00Z"));
    expect(verifyApprovalCode(code).valid).toBe(true);
  });

  it("produces different random segments across calls (not deterministic)", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateApprovalCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("verifyApprovalCode — the whole point: catching mistakes fast", () => {
  it("accepts a freshly generated code", () => {
    const code = generateApprovalCode(new Date("2026-09-15T00:00:00Z"));
    const result = verifyApprovalCode(code);
    expect(result.valid).toBe(true);
    expect(result.formatted).toBe(code);
  });

  it("is case-insensitive", () => {
    const code = generateApprovalCode(new Date("2026-09-15T00:00:00Z"));
    expect(verifyApprovalCode(code.toLowerCase()).valid).toBe(true);
  });

  it("is separator-insensitive (dashes, spaces, or none at all)", () => {
    const code = generateApprovalCode(new Date("2026-09-15T00:00:00Z"));
    const noDashes = code.replace(/-/g, "");
    const spaced = code.replace(/-/g, " ");
    expect(verifyApprovalCode(noDashes).valid).toBe(true);
    expect(verifyApprovalCode(spaced).valid).toBe(true);
  });

  it("applies Crockford's I/L->1 and O->0 look-alike mapping", () => {
    // Build a code whose random segment we control by checking many
    // generated codes for one containing a digit we can substitute, or
    // more directly: construct a payload manually and derive its check char.
    const payload = "FC26090ABC1"; // contains 0 and 1 we can mangle to O/I/L below
    const check = computeCheckChar(payload);
    const canonical = `FC-2609-0ABC1-${check}`;
    expect(verifyApprovalCode(canonical).valid).toBe(true);

    // Type "O" instead of "0", and "I" or "L" instead of "1".
    const mistyped = canonical.replace("0ABC1", "OABCI");
    expect(verifyApprovalCode(mistyped).valid).toBe(true);
    const mistyped2 = canonical.replace("0ABC1", "OABCL");
    expect(verifyApprovalCode(mistyped2).valid).toBe(true);
  });

  it("rejects a single mistyped character in the random segment", () => {
    const code = generateApprovalCode(new Date("2026-09-15T00:00:00Z"));
    const [prefix, yymm, random5, check] = code.split("-");
    // Flip the first character of the random segment to something else in
    // the alphabet (guaranteed different, wrapping around if needed).
    const firstCharIndex = CROCKFORD_ALPHABET.indexOf(random5![0]!);
    const differentChar =
      CROCKFORD_ALPHABET[(firstCharIndex + 1) % CROCKFORD_ALPHABET.length];
    const mangledRandom5 = differentChar + random5!.slice(1);
    const mangledCode = `${prefix}-${yymm}-${mangledRandom5}-${check}`;

    expect(verifyApprovalCode(mangledCode).valid).toBe(false);
  });

  it("rejects a mistyped check character", () => {
    const code = generateApprovalCode(new Date("2026-09-15T00:00:00Z"));
    const [prefix, yymm, random5, check] = code.split("-");
    const checkIndex = CROCKFORD_ALPHABET.indexOf(check!);
    const differentCheck =
      CROCKFORD_ALPHABET[(checkIndex + 1) % CROCKFORD_ALPHABET.length];
    const mangledCode = `${prefix}-${yymm}-${random5}-${differentCheck}`;

    expect(verifyApprovalCode(mangledCode).valid).toBe(false);
  });

  it("catches a transposition of two adjacent characters in the random segment", () => {
    // Find a generated code whose random segment has two DIFFERENT
    // adjacent characters (guaranteed to exist almost always; loop a few
    // times for robustness against the rare all-same-char case).
    let code: string;
    let random5: string;
    do {
      code = generateApprovalCode(new Date("2026-09-15T00:00:00Z"));
      random5 = code.split("-")[2]!;
    } while (random5[0] === random5[1]);

    const [prefix, yymm, , check] = code.split("-");
    const transposed = random5[1]! + random5[0]! + random5.slice(2);
    const transposedCode = `${prefix}-${yymm}-${transposed}-${check}`;

    expect(verifyApprovalCode(transposedCode).valid).toBe(false);
  });

  it("rejects garbage input structurally (wrong length)", () => {
    expect(verifyApprovalCode("FC-2609-ABC").valid).toBe(false);
    expect(verifyApprovalCode("not a code at all").valid).toBe(false);
    expect(verifyApprovalCode("").valid).toBe(false);
  });

  it("rejects a code with the right shape but wrong prefix", () => {
    const code = generateApprovalCode(new Date("2026-09-15T00:00:00Z"));
    const wrongPrefix = code.replace(/^FC-/, "XX-");
    expect(verifyApprovalCode(wrongPrefix).valid).toBe(false);
  });
});

describe("normalizeApprovalCodeInput", () => {
  it("strips punctuation and whitespace the user might paste in", () => {
    const code = generateApprovalCode(new Date("2026-09-15T00:00:00Z"));
    const messy = "  " + code.toLowerCase().replace(/-/g, " . ") + "  ";
    expect(normalizeApprovalCodeInput(messy)).toBe(normalizeApprovalCodeInput(code));
  });

  it("returns null for input that normalizes to the wrong length", () => {
    expect(normalizeApprovalCodeInput("FC2609ABC")).toBeNull();
  });

  it("silently drops disallowed characters like U (no look-alike mapping defined for it)", () => {
    // "U" isn't in the alphabet and has no substitution — it's just
    // stripped, per "strip anything that is not an allowed character."
    const withU = "FUC2609UABCD1X";
    const without = "FC2609ABCD1X";
    expect(normalizeApprovalCodeInput(withU)).toBe(normalizeApprovalCodeInput(without));
  });
});

describe("computeCheckChar — error paths", () => {
  it("throws for the wrong-length payload rather than silently truncating/padding", () => {
    expect(() => computeCheckChar("TOOSHORT")).toThrow(/11-character payload/);
    expect(() => computeCheckChar("FC26090ABC12EXTRA")).toThrow(/11-character payload/);
  });

  it("throws for a character outside the Crockford alphabet rather than silently skipping it", () => {
    // 11 characters, but "U" isn't in the alphabet by design.
    expect(() => computeCheckChar("FC2609ABCU1")).toThrow(
      /not in the Crockford alphabet/,
    );
  });
});
