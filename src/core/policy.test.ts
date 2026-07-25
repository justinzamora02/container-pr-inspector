import { describe, expect, it } from "vitest";
import { evaluateTargetPolicy } from "./policy.js";
import type {
  InspectorConfig,
  NormalizedFinding,
  TargetResult
} from "./types.js";

const targetConfig = {
  name: "app",
  dockerfile: "Dockerfile",
  context: ".",
  baseImage: "example.test/app:${sha}",
  build: { args: {} }
};

function target(overrides: Partial<TargetResult> = {}): TargetResult {
  return {
    name: "app",
    configuration: targetConfig,
    base: {
      sha: "a",
      source: "registry",
      verification: "verified",
      image: {
        reference: "base",
        imageId: "base-id",
        platform: { os: "linux", architecture: "amd64" },
        sizeBytes: 100,
        layers: [],
        user: "1000",
        healthcheck: { test: ["CMD", "true"] }
      }
    },
    head: {
      sha: "b",
      image: {
        reference: "head",
        imageId: "head-id",
        platform: { os: "linux", architecture: "amd64" },
        sizeBytes: 120,
        layers: [],
        user: "1000",
        healthcheck: { test: ["CMD", "true"] }
      }
    },
    adapters: [{ name: "trivy", state: "completed" }],
    sbom: {},
    vulnerabilities: {},
    findings: [],
    policy: { reportOnly: true, status: "passed", evaluations: [] },
    warnings: [],
    ...overrides
  };
}

function config(gates: InspectorConfig["gates"]): InspectorConfig {
  return {
    version: 1,
    targets: [targetConfig],
    scanners: { trivy: true, syft: true },
    gates
  };
}

describe("policy evaluation", () => {
  it("enforces both absolute and percent size limits", () => {
    const policy = evaluateTargetPolicy(
      config({
        imageSize: { maxIncreaseBytes: 25, maxIncreasePercent: 10 }
      }),
      target(),
      "compare"
    );
    expect(policy.status).toBe("failed");
    expect(policy.evaluations.map(({ status }) => status)).toEqual([
      "passed",
      "failed"
    ]);
  });

  it("fails a scanner-dependent gate when the scanner is unavailable", () => {
    const policy = evaluateTargetPolicy(
      config({ vulnerabilities: { maxNew: { high: 0 } } }),
      target({
        adapters: [
          { name: "trivy", state: "skipped", reason: "binary not found" }
        ]
      }),
      "compare"
    );
    expect(policy.status).toBe("failed");
    expect(policy.evaluations[0]).toMatchObject({
      status: "not-evaluated",
      reason: "binary not found"
    });
  });

  it("keeps fork image gates neutral", () => {
    const staticTarget = target({ head: { sha: "b" } });
    delete staticTarget.base;
    const policy = evaluateTargetPolicy(
      config({ disallowRoot: true, requireHealthcheck: true }),
      staticTarget,
      "static"
    );
    expect(policy.status).toBe("neutral");
    expect(policy.evaluations.every(({ status }) => status === "not-evaluated")).toBe(
      true
    );
  });

  it("counts only new vulnerabilities at the requested severity", () => {
    const findings: NormalizedFinding[] = [
      {
        id: "1",
        identity: "one",
        target: "app",
        kind: "vulnerability",
        status: "new",
        severity: "high",
        title: "one"
      },
      {
        id: "2",
        identity: "two",
        target: "app",
        kind: "vulnerability",
        status: "unchanged",
        severity: "high",
        title: "two"
      }
    ];
    const policy = evaluateTargetPolicy(
      config({ vulnerabilities: { maxNew: { high: 0 } } }),
      target({ findings }),
      "compare"
    );
    expect(policy.evaluations[0]).toMatchObject({ actual: 1, status: "failed" });
  });
});
