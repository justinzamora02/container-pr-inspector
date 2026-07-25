import { describe, expect, it } from "vitest";
import { renderJson } from "./render.js";
import externalSchema from "../../schema/result-v1.schema.json" with { type: "json" };
import { RESULT_V1_SCHEMA, validateResult } from "./schema.js";
import type { InspectionResult } from "./types.js";

describe("result schema", () => {
  it("keeps the published schema synchronized with runtime validation", () => {
    expect(externalSchema).toEqual(RESULT_V1_SCHEMA);
  });

  it("accepts a complete minimal v1 result and renders deterministically", () => {
    const result: InspectionResult = {
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
    expect(() => validateResult(result)).not.toThrow();
    expect(renderJson(result)).toBe(renderJson(result));
  });

  it("rejects an unknown schema version", () => {
    expect(() =>
      validateResult({ schemaVersion: 2 } as unknown as InspectionResult)
    ).toThrow(/must be equal to constant|schemaVersion/i);
  });
});
