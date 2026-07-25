import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectDockerfileStatically } from "./static.js";
import type { LoadedConfig, TargetConfig } from "./types.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

function fixture(name: string): {
  loaded: LoadedConfig;
  target: TargetConfig;
} {
  const target: TargetConfig = {
    name: "app",
    dockerfile: `tests/fixtures/docker/${name}`,
    context: ".",
    baseImage: "example.test/app:${sha}",
    build: { args: {} }
  };
  return {
    loaded: {
      configPath: path.join(repositoryRoot, ".container-pr-inspector.yml"),
      repositoryRoot,
      config: {
        version: 1,
        targets: [target],
        scanners: { trivy: false, syft: false },
        gates: {}
      }
    },
    target
  };
}

describe("inspectDockerfileStatically fixtures", () => {
  it("accepts a non-root image with a health check", async () => {
    const { loaded, target } = fixture("nonroot-healthcheck.Dockerfile");
    const result = await inspectDockerfileStatically(loaded, target);

    expect(result).toMatchObject({
      user: "10001",
      hasHealthcheck: true,
      findings: []
    });
  });

  it("reports root execution and a missing health check", async () => {
    const { loaded, target } = fixture("root-no-healthcheck.Dockerfile");
    const result = await inspectDockerfileStatically(loaded, target);

    expect(result.findings.map((finding) => finding.identity)).toEqual([
      "misconfiguration:dockerfile:root-user",
      "misconfiguration:dockerfile:missing-healthcheck"
    ]);
  });

  it("uses the final stage of a multi-stage Dockerfile", async () => {
    const { loaded, target } = fixture("multistage.Dockerfile");
    const result = await inspectDockerfileStatically(loaded, target);

    expect(result).toMatchObject({
      user: "10001",
      hasHealthcheck: true,
      findings: []
    });
  });
});
