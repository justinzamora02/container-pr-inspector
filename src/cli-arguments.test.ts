import { describe, expect, it } from "vitest";
import {
  AUDIT_HELP,
  CliArgumentError,
  COMPARE_HELP,
  parseCliArguments,
  ROOT_HELP
} from "./cli-arguments.js";

describe("parseCliArguments", () => {
  it("parses compare arguments and applies defaults", () => {
    expect(
      parseCliArguments([
        "compare",
        "--base-sha",
        "base",
        "--head-sha",
        "WORKTREE"
      ])
    ).toEqual({
      command: "compare",
      baseSha: "base",
      headSha: "WORKTREE",
      config: ".container-pr-inspector.yml",
      format: "terminal"
    });
  });

  it("parses every audit option", () => {
    expect(
      parseCliArguments([
        "audit",
        "--ref",
        "head",
        "--config",
        "inspector.yml",
        "--repository",
        "owner/repo",
        "--format",
        "json",
        "--output",
        "result.json"
      ])
    ).toEqual({
      command: "audit",
      ref: "head",
      config: "inspector.yml",
      repository: "owner/repo",
      format: "json",
      output: "result.json"
    });
  });

  it("supports root, command, and help-command help", () => {
    expect(parseCliArguments(["--help"])).toEqual({
      command: "help",
      text: ROOT_HELP,
      exitCode: 0
    });
    expect(parseCliArguments(["compare", "-h"])).toEqual({
      command: "help",
      text: COMPARE_HELP,
      exitCode: 0
    });
    expect(parseCliArguments(["help", "audit"])).toEqual({
      command: "help",
      text: AUDIT_HELP,
      exitCode: 0
    });
    expect(parseCliArguments([])).toEqual({
      command: "help",
      text: ROOT_HELP,
      exitCode: 2
    });
  });

  it("supports both version flags", () => {
    expect(parseCliArguments(["--version"])).toEqual({ command: "version" });
    expect(parseCliArguments(["-V"])).toEqual({ command: "version" });
  });

  it("rejects missing required arguments", () => {
    expect(() => parseCliArguments(["compare"])).toThrow(
      /required option '--base-sha <sha>'/
    );
    expect(() => parseCliArguments(["audit"])).toThrow(
      /required option '--ref <sha-or-WORKTREE>'/
    );
  });

  it("rejects invalid formats and unknown options with command help", () => {
    for (const args of [
      [
        "compare",
        "--base-sha",
        "base",
        "--head-sha",
        "head",
        "--format",
        "xml"
      ],
      ["audit", "--ref", "head", "--unknown"]
    ]) {
      try {
        parseCliArguments(args);
        throw new Error("expected parsing to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(CliArgumentError);
        expect((error as CliArgumentError).help).toMatch(
          /container-pr-inspector (compare|audit)/
        );
      }
    }
  });

  it("rejects unknown commands", () => {
    expect(() => parseCliArguments(["unknown"])).toThrow(
      /unknown command 'unknown'/
    );
  });
});
