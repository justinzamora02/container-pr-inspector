import { describe, expect, it } from "vitest";
import { renderJson } from "./render.js";
import externalSchema from "../../schema/result-v1.schema.json" with { type: "json" };
import { RESULT_V1_SCHEMA, validateResult } from "./schema.js";
import type { InspectionResult, TargetResult } from "./types.js";

function resultFixture(): InspectionResult {
  return {
    schemaVersion: 1,
    run: {
      id: "run",
      mode: "audit",
      startedAt: "2026-07-25T00:00:00.000Z",
      finishedAt: "2026-07-25T00:00:01.000Z",
      headSha: "abc"
    },
    tools: {
      inspectorVersion: "1.0.0",
      nodeVersion: "v24.0.0",
      adapters: []
    },
    targets: [],
    policy: { reportOnly: true, status: "passed", evaluations: [] },
    conclusion: "passed",
    warnings: []
  };
}

function targetFixture(): TargetResult {
  return {
    name: "app",
    configuration: {
      name: "app",
      dockerfile: "Dockerfile",
      context: ".",
      baseImage: "example.test/app:${sha}",
      build: { args: {} }
    },
    head: { sha: "abc" },
    adapters: [{ name: "trivy", state: "completed", version: "1.0.0" }],
    sbom: {},
    vulnerabilities: {},
    findings: [
      {
        id: "finding",
        identity: "vulnerability:CVE-1:pkg:apk/openssl",
        target: "app",
        kind: "vulnerability",
        status: "new",
        severity: "high",
        title: "CVE-1",
        vulnerabilityId: "CVE-1",
        package: {
          name: "openssl",
          version: "1.0"
        }
      }
    ],
    policy: { reportOnly: true, status: "passed", evaluations: [] },
    warnings: []
  };
}

describe("result schema", () => {
  it("keeps the published schema synchronized with runtime validation", () => {
    expect(externalSchema).toEqual(RESULT_V1_SCHEMA);
  });

  it("accepts a complete minimal v1 result and renders deterministically", () => {
    const result = resultFixture();
    result.targets.push(targetFixture());
    expect(() => validateResult(result)).not.toThrow();
    expect(renderJson(result)).toBe(renderJson(result));
  });

  it("rejects an unknown schema version", () => {
    expect(() =>
      validateResult({ schemaVersion: 2 } as unknown as InspectionResult)
    ).toThrow(/must be equal to constant|schemaVersion/i);
  });

  it("rejects malformed target fields and unexpected properties", () => {
    const result = resultFixture();
    const target = targetFixture();
    Object.assign(target, { name: 42, unexpected: true });
    result.targets.push(target);
    expect(() => validateResult(result)).toThrow(/targets|name|additional/i);
  });

  it("rejects malformed nested adapters and findings", () => {
    const result = resultFixture();
    const target = targetFixture();
    target.adapters = [
      { name: "trivy", state: "bogus" }
    ] as unknown as TargetResult["adapters"];
    target.findings[0] = {
      id: "finding",
      severity: "urgent"
    } as unknown as TargetResult["findings"][number];
    result.targets.push(target);
    expect(() => validateResult(result)).toThrow(/adapter|finding|state|severity/i);
  });

  it("rejects malformed policy values", () => {
    const result = resultFixture();
    result.policy = {
      reportOnly: "yes",
      status: 42,
      evaluations: null
    } as unknown as InspectionResult["policy"];
    expect(() => validateResult(result)).toThrow(/policy|reportOnly|status/i);
  });
});
