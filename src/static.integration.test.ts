import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspect } from "./application.js";
import { runCommand } from "./core/process.js";

describe.sequential("static fork pipeline", () => {
  it("scopes Trivy findings to each configured Dockerfile", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cpi-static-targets-"));
    const tools = await mkdtemp(path.join(os.tmpdir(), "cpi-static-tools-"));
    const previousCwd = process.cwd();
    const previousPath = process.env.PATH;
    try {
      const trivy = path.join(tools, "trivy");
      await writeFile(
        trivy,
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "Version: fake"
  exit 0
fi
for argument in "$@"; do scan_path="$argument"; done
name="\${scan_path##*/}"
printf '{"Results":[{"Target":"%s","Misconfigurations":[{"ID":"TRIVY-%s","Title":"%s","Severity":"LOW"}]}]}\\n' "$name" "$name" "$name"
`
      );
      await chmod(trivy, 0o755);
      await runCommand("git", ["init", "--initial-branch=master"], { cwd: root });
      await writeFile(path.join(root, "app.Dockerfile"), "FROM scratch\n");
      await writeFile(path.join(root, "worker.Dockerfile"), "FROM scratch\n");
      await writeFile(
        path.join(root, ".container-pr-inspector.yml"),
        `version: 1
targets:
  - name: app
    dockerfile: app.Dockerfile
    context: .
    baseImage: example.test/app:\${sha}
  - name: worker
    dockerfile: worker.Dockerfile
    context: .
    baseImage: example.test/worker:\${sha}
scanners:
  trivy: true
  syft: false
gates: {}
`
      );
      await runCommand("git", ["add", "."], { cwd: root });
      await runCommand(
        "git",
        [
          "-c",
          "user.name=Container PR Inspector",
          "-c",
          "user.email=inspector@example.invalid",
          "commit",
          "-m",
          "fixture"
        ],
        { cwd: root }
      );
      const headSha = (
        await runCommand("git", ["rev-parse", "HEAD"], { cwd: root })
      ).stdout.trim();
      process.env.PATH = `${tools}${path.delimiter}${previousPath ?? ""}`;
      process.chdir(root);

      const result = await inspect({
        mode: "static",
        headSha,
        configPath: ".container-pr-inspector.yml"
      });

      expect(
        Object.fromEntries(
          result.targets.map((target) => [
            target.name,
            target.findings
              .filter((finding) => finding.identity.includes("TRIVY-"))
              .map((finding) => finding.identity)
          ])
        )
      ).toEqual({
        app: ["misconfiguration:TRIVY-app.Dockerfile:app.Dockerfile"],
        worker: [
          "misconfiguration:TRIVY-worker.Dockerfile:worker.Dockerfile"
        ]
      });
    } finally {
      process.chdir(previousCwd);
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(tools, { recursive: true, force: true })
      ]);
    }
  });

  it("returns a neutral result without Docker or image scanners", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cpi-static-"));
    const previous = process.cwd();
    try {
      await runCommand("git", ["init", "--initial-branch=master"], { cwd: root });
      await writeFile(
        path.join(root, "Dockerfile"),
        "FROM scratch\nRUN echo this-must-never-run\n"
      );
      await writeFile(
        path.join(root, ".container-pr-inspector.yml"),
        `version: 1
targets:
  - name: app
    dockerfile: Dockerfile
    context: .
    baseImage: example.test/app:\${sha}
scanners:
  trivy: false
  syft: false
gates:
  disallowRoot: true
`
      );
      await runCommand("git", ["add", "."], { cwd: root });
      await runCommand(
        "git",
        [
          "-c",
          "user.name=Container PR Inspector",
          "-c",
          "user.email=inspector@example.invalid",
          "commit",
          "-m",
          "fixture"
        ],
        { cwd: root }
      );
      const headSha = (
        await runCommand("git", ["rev-parse", "HEAD"], { cwd: root })
      ).stdout.trim();
      process.chdir(root);

      const result = await inspect({
        mode: "static",
        headSha,
        configPath: ".container-pr-inspector.yml"
      });

      expect(result.conclusion).toBe("neutral");
      expect(result.policy.status).toBe("neutral");
      expect(result.targets[0]?.policy.evaluations[0]).toMatchObject({
        gate: "disallowRoot",
        status: "not-evaluated",
        reason: "fork-isolation"
      });
      expect(
        result.targets[0]?.findings.some(
          (finding) => finding.identity === "misconfiguration:dockerfile:root-user"
        )
      ).toBe(true);
    } finally {
      process.chdir(previous);
      await rm(root, { recursive: true, force: true });
    }
  });
});
