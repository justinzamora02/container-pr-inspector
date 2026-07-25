import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const temporaryDirectories: string[] = [];

async function fixture(configuration: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cpi-config-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "app"));
  await writeFile(path.join(root, "app", "Dockerfile"), "FROM scratch\n");
  await writeFile(path.join(root, ".container-pr-inspector.yml"), configuration);
  return root;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("loadConfig", () => {
  it("applies scanner and build defaults and converts literal args", async () => {
    const root = await fixture(`
version: 1
targets:
  - name: app
    dockerfile: app/Dockerfile
    context: app
    baseImage: ghcr.io/\${owner}/\${repo}:base-\${sha}
    build:
      args:
        PORT: 3000
        DEBUG: false
gates: {}
`);
    const loaded = await loadConfig(".container-pr-inspector.yml", root);
    expect(loaded.config.scanners).toEqual({ trivy: true, syft: true });
    expect(loaded.config.targets[0]?.build.args).toEqual({
      PORT: "3000",
      DEBUG: "false"
    });
  });

  it("rejects duplicate targets and unknown keys", async () => {
    const root = await fixture(`
version: 1
targets:
  - &target
    name: app
    dockerfile: app/Dockerfile
    context: app
    baseImage: example.test/app:\${sha}
  - <<: *target
extra: true
`);
    await expect(
      loadConfig(".container-pr-inspector.yml", root)
    ).rejects.toThrow(/unrecognized key|duplicate/i);
  });

  it("rejects unsupported variables and non-SHA tags", async () => {
    const root = await fixture(`
version: 1
targets:
  - name: app
    dockerfile: app/Dockerfile
    context: app
    baseImage: example.test/app:\${branch}
`);
    await expect(
      loadConfig(".container-pr-inspector.yml", root)
    ).rejects.toThrow(/unsupported template/i);
  });

  it("rejects paths that resolve outside the repository", async () => {
    const root = await fixture(`
version: 1
targets:
  - name: app
    dockerfile: app/link
    context: app
    baseImage: example.test/app:\${sha}
`);
    await symlink("/etc/hosts", path.join(root, "app", "link"));
    await expect(
      loadConfig(".container-pr-inspector.yml", root)
    ).rejects.toThrow(/outside the repository/i);
  });
});
