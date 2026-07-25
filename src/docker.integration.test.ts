import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspect } from "./application.js";
import { runCommand } from "./core/process.js";

async function availablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("could not allocate registry port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

const cleanupDirectories: string[] = [];
const cleanupContainers: string[] = [];

afterEach(async () => {
  for (const container of cleanupContainers.splice(0)) {
    await runCommand("docker", ["rm", "--force", container], {
      allowFailure: true,
      timeoutMs: 30_000
    });
  }
  await Promise.all(
    cleanupDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe.skipIf(process.env.CPI_INTEGRATION !== "1")(
  "Docker registry integration",
  () => {
    it("accepts an exact revision-labelled base and records its digest", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "cpi-integration-"));
      cleanupDirectories.push(root);
      const port = await availablePort();
      const registry = `127.0.0.1:${port}`;
      const container = `cpi-registry-${process.pid}-${port}`;
      cleanupContainers.push(container);

      await runCommand(
        "docker",
        [
          "run",
          "--detach",
          "--rm",
          "--name",
          container,
          "--publish",
          `127.0.0.1:${port}:5000`,
          "registry:2"
        ],
        { timeoutMs: 2 * 60 * 1000 }
      );
      await runCommand("git", ["init", "--initial-branch=master"], { cwd: root });
      await writeFile(
        path.join(root, "Dockerfile"),
        "FROM scratch\nCOPY payload /payload\n"
      );
      await writeFile(path.join(root, "payload"), "base\n");
      await writeFile(
        path.join(root, ".container-pr-inspector.yml"),
        `version: 1
targets:
  - name: app
    dockerfile: Dockerfile
    context: .
    baseImage: ${registry}/app:\${sha}
scanners:
  trivy: false
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
          "base"
        ],
        { cwd: root }
      );
      const baseSha = (
        await runCommand("git", ["rev-parse", "HEAD"], { cwd: root })
      ).stdout.trim();
      const remoteBase = `${registry}/app:${baseSha}`;
      await runCommand(
        "docker",
        [
          "buildx",
          "build",
          "--load",
          "--provenance=false",
          "--label",
          `org.opencontainers.image.revision=${baseSha}`,
          "--tag",
          remoteBase,
          root
        ],
        { timeoutMs: 20 * 60 * 1000 }
      );
      await runCommand("docker", ["push", remoteBase], {
        timeoutMs: 2 * 60 * 1000
      });

      await writeFile(path.join(root, "payload"), "head\n");
      await runCommand("git", ["add", "payload"], { cwd: root });
      await runCommand(
        "git",
        [
          "-c",
          "user.name=Container PR Inspector",
          "-c",
          "user.email=inspector@example.invalid",
          "commit",
          "-m",
          "head"
        ],
        { cwd: root }
      );
      const headSha = (
        await runCommand("git", ["rev-parse", "HEAD"], { cwd: root })
      ).stdout.trim();

      const previous = process.cwd();
      process.chdir(root);
      try {
        const result = await inspect({
          mode: "compare",
          baseSha,
          headSha,
          configPath: ".container-pr-inspector.yml",
          repository: "example/project"
        });
        expect(result.conclusion).toBe("passed");
        expect(result.run.baseSha).toBe(baseSha);
        expect(result.run.headSha).toBe(headSha);
        expect(result.targets[0]?.base?.source).toBe("registry");
        expect(result.targets[0]?.base?.image?.digest).toMatch(
          /@sha256:|^sha256:/
        );
      } finally {
        process.chdir(previous);
      }
    });
  }
);
