import { describe, expect, it } from "vitest";
import { runCommand } from "./process.js";

describe("process adapter", () => {
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
