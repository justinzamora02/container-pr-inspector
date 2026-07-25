import { describe, expect, it } from "vitest";
import { repositoryFromRemote } from "./git.js";

describe("GitHub repository inference", () => {
  it.each([
    ["https://github.com/octo/app.git", "octo/app"],
    ["git@github.com:octo/app.git", "octo/app"],
    ["ssh://git@github.com/octo/app", "octo/app"]
  ])("parses %s", (remote, expected) => {
    expect(repositoryFromRemote(remote)).toBe(expected);
  });

  it("ignores non-GitHub remotes", () => {
    expect(repositoryFromRemote("https://example.test/octo/app.git")).toBeUndefined();
  });
});
