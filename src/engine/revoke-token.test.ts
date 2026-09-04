import { describe, it, expect } from "vitest";
import { generateRevokeToken, verifyRevokeToken } from "./revoke-token.js";

describe("generateRevokeToken", () => {
  it("produces a raw token whose hash matches the stored hash", () => {
    const token = generateRevokeToken();
    expect(verifyRevokeToken(token.rawToken, token.hash)).toBe(true);
  });

  it("defaults to a 72-hour expiry window", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    const token = generateRevokeToken(now);
    expect(token.expiresAt.toISOString()).toBe("2026-09-06T12:00:00.000Z");
  });

  it("respects a custom window", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    const token = generateRevokeToken(now, 24);
    expect(token.expiresAt.toISOString()).toBe("2026-09-04T12:00:00.000Z");
  });

  it("generates different tokens on every call", () => {
    const tokens = new Set(
      Array.from({ length: 20 }, () => generateRevokeToken().rawToken),
    );
    expect(tokens.size).toBe(20);
  });
});

describe("verifyRevokeToken", () => {
  it("rejects a wrong token", () => {
    const token = generateRevokeToken();
    const other = generateRevokeToken();
    expect(verifyRevokeToken(other.rawToken, token.hash)).toBe(false);
  });

  it("rejects a tampered/malformed token without throwing", () => {
    const token = generateRevokeToken();
    expect(verifyRevokeToken("not-a-real-hex-token", token.hash)).toBe(false);
    expect(verifyRevokeToken("", token.hash)).toBe(false);
  });
});

describe("verifyRevokeToken — length mismatch branch", () => {
  it("rejects a storedHash of the wrong length without throwing (distinct from a wrong-but-same-length hash)", () => {
    const token = generateRevokeToken();
    // A deliberately short "hash" — hashRevokeToken always normalizes any
    // input to a valid 64-char hex digest, so the only way to exercise
    // the length-mismatch branch is to pass a malformed storedHash
    // directly, bypassing hashing.
    expect(verifyRevokeToken(token.rawToken, "abcd")).toBe(false);
  });
});
