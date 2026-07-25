import { describe, expect, it } from "vitest";
import { exitCodeFor, failureResult } from "./application.js";
import { ConfigurationError, InspectorError } from "./core/errors.js";

const options = {
  mode: "audit" as const,
  ref: "WORKTREE",
  configPath: ".container-pr-inspector.yml"
};

describe("application failure contract", () => {
  it("returns exit 2 for configuration and operational failures", () => {
    const configuration = failureResult(
      options,
      new ConfigurationError("bad config")
    );
    const scanner = failureResult(
      options,
      new InspectorError("SCANNER_FAILED", "scanner crashed")
    );
    expect(configuration.conclusion).toBe("config-error");
    expect(scanner.conclusion).toBe("scanner-failed");
    expect(exitCodeFor(configuration)).toBe(2);
    expect(exitCodeFor(scanner)).toBe(2);
  });

  it("returns exit 1 only for policy failures", () => {
    const result = failureResult(options, new Error("unused"));
    result.conclusion = "policy-failed";
    expect(exitCodeFor(result)).toBe(1);
    result.conclusion = "passed-with-warnings";
    expect(exitCodeFor(result)).toBe(0);
  });
});
