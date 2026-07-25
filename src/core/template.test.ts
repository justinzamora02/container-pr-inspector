import { describe, expect, it } from "vitest";
import {
  expandImageTemplate,
  parseRepository
} from "./template.js";

describe("image templates", () => {
  it("expands only explicit context values", () => {
    expect(
      expandImageTemplate("ghcr.io/${owner}/${repo}:base-${sha}", {
        owner: "octo",
        repo: "app",
        sha: "abc"
      })
    ).toBe("ghcr.io/octo/app:base-abc");
  });

  it("rejects unsupported variables", () => {
    expect(() =>
      expandImageTemplate("example.test/app:${branch}", {
        owner: "octo",
        repo: "app",
        sha: "abc"
      })
    ).toThrow(/unsupported template variable/i);
  });

  it("parses exact owner/repo syntax", () => {
    expect(parseRepository("octo/app")).toEqual({
      owner: "octo",
      repo: "app",
      fullName: "octo/app"
    });
    expect(() => parseRepository("octo/app/extra")).toThrow();
  });
});
