import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(
      true,
    );
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("Correct horse battery staple", hash)).resolves.toBe(
      false,
    );
  });

  it("salts each hash, so identical passwords differ on disk", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same password"),
      hashPassword("same password"),
    ]);
    expect(a).not.toEqual(b);
  });

  it("records its parameters so cost factors can be raised later", async () => {
    const hash = await hashPassword("whatever");
    const [scheme, n, r, p] = hash.split("$");
    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  it("handles unicode passwords consistently", async () => {
    const hash = await hashPassword("pässwörd–é");
    await expect(verifyPassword("pässwörd–é", hash)).resolves.toBe(true);
  });

  // A corrupt or truncated row must fail the login rather than throw and
  // surface as a 500 from the login endpoint.
  it.each([
    ["empty", ""],
    ["not our format", "plaintext-password"],
    ["wrong scheme", "bcrypt$1$2$3$c2FsdA==$aGFzaA=="],
    ["too few fields", "scrypt$16384$8$c2FsdA=="],
    ["non-numeric cost", "scrypt$abc$8$1$c2FsdA==$aGFzaA=="],
  ])("returns false for a %s hash", async (_label, stored) => {
    await expect(verifyPassword("anything", stored)).resolves.toBe(false);
  });
});
