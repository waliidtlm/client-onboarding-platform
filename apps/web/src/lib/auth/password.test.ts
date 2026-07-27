import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("creates an Argon2id hash and verifies only the matching password", async () => {
    const passwordHash = await hashPassword("fictional-local-password");

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(passwordHash, "fictional-local-password")).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, "incorrect-password")).resolves.toBe(false);
  });

  it("returns false for an invalid stored hash", async () => {
    await expect(verifyPassword("not-a-password-hash", "password")).resolves.toBe(false);
  });
});
