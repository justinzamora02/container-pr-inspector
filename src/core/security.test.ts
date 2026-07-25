import { describe, expect, it } from "vitest";
import {
  escapeMarkdown,
  sanitizeText,
  toolEnvironment,
  truncateUtf8
} from "./security.js";

describe("output security", () => {
  it("removes control sequences and redacts common credentials", () => {
    const text = sanitizeText(
      "\u001b[31mAuthorization: Bearer abc.def.ghi\nhttps://user:password@example.test"
    );
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("abc.def.ghi");
    expect(text).not.toContain("password");
    expect(text).toContain("[REDACTED]");
  });

  it("escapes markdown and truncates by UTF-8 bytes", () => {
    expect(escapeMarkdown("**boom**")).toBe("\\*\\*boom\\*\\*");
    expect(Buffer.byteLength(truncateUtf8("😀".repeat(100), 64))).toBeLessThanOrEqual(
      64
    );
  });

  it("does not forward token-like environment variables to tools", () => {
    const previous = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "secret";
    try {
      expect(toolEnvironment().GITHUB_TOKEN).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previous;
    }
  });
});
