import { describe, expect, it } from "vitest";
import { displayCommand, runCommand } from "./process.js";

describe("process adapter", () => {
  it("redacts build argument values from diagnostic commands", () => {
    const displayed = displayCommand("docker", [
      "buildx",
      "build",
      "--build-arg",
      "NPM_TOKEN=supersecret",
      "."
    ]);
    expect(displayed).toContain("NPM_TOKEN=[REDACTED]");
    expect(displayed).not.toContain("supersecret");
  });

  it("captures successful output without a shell", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "process.stdout.write(process.argv[1])", "literal;$HOME"],
      { timeoutMs: 5_000 }
    );
    expect(result.stdout).toBe("literal;$HOME");
  });

  it("surfaces exit status and sanitizes stderr", async () => {
    await expect(
      runCommand(
        process.execPath,
        [
          "-e",
          "process.stderr.write('token=super-secret-value'); process.exit(7)"
        ],
        { timeoutMs: 5_000 }
      )
    ).rejects.toMatchObject({
      exitCode: 7,
      stderr: "token=[REDACTED]"
    });
  });
});
