import { Ajv } from "ajv";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";
import type { InspectionResult } from "./types.js";
import { InspectorError } from "./errors.js";

export const RESULT_V1_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://container-pr-inspector.dev/schemas/result-v1.json",
  title: "Container PR Inspector result v1",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "run",
    "tools",
    "targets",
    "policy",
    "conclusion",
    "warnings"
  ],
  properties: {
    schemaVersion: { const: 1 },
    run: {
      type: "object",
      required: ["id", "mode", "startedAt", "finishedAt", "headSha"],
      properties: {
        id: { type: "string", minLength: 1 },
        mode: { enum: ["compare", "audit", "static"] },
        startedAt: { type: "string", format: "date-time" },
        finishedAt: { type: "string", format: "date-time" },
        repository: { type: "string" },
        baseSha: { type: "string" },
        headSha: { type: "string", minLength: 1 },
        platform: { type: "object" }
      },
      additionalProperties: false
    },
    tools: {
      type: "object",
      required: ["inspectorVersion", "nodeVersion", "adapters"],
      properties: {
        inspectorVersion: { type: "string" },
        nodeVersion: { type: "string" },
        adapters: { type: "array", items: { type: "object" } }
      },
      additionalProperties: false
    },
    targets: {
      type: "array",
      items: {
        type: "object",
        required: [
          "name",
          "configuration",
          "adapters",
          "sbom",
          "vulnerabilities",
          "findings",
          "policy",
          "warnings"
        ]
      }
    },
    policy: {
      type: "object",
      required: ["reportOnly", "status", "evaluations"]
    },
    conclusion: {
      enum: [
        "passed",
        "passed-with-warnings",
        "neutral",
        "policy-failed",
        "config-error",
        "base-resolution-failed",
        "base-build-failed",
        "head-build-failed",
        "scanner-failed",
        "reporting-failed"
      ]
    },
    warnings: { type: "array", items: { type: "string" } }
  }
} as const;

const ajv = new Ajv({
  allErrors: true,
  strict: false
});
const addFormats = addFormatsModule as unknown as FormatsPlugin;
addFormats(ajv);
const validate = ajv.compile(RESULT_V1_SCHEMA);

export function validateResult(result: InspectionResult): void {
  if (!validate(result)) {
    const details = (validate.errors ?? [])
      .map(
        (error: { instancePath: string; message?: string }) =>
          `${error.instancePath || "/"} ${error.message ?? "invalid"}`
      )
      .join("; ");
    throw new InspectorError("RESULT_SCHEMA_INVALID", details);
  }
}
