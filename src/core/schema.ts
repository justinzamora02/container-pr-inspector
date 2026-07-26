import { Ajv } from "ajv";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";
import resultV1Schema from "../../schema/result-v1.schema.json" with { type: "json" };
import type { InspectionResult } from "./types.js";
import { InspectorError } from "./errors.js";

export const RESULT_V1_SCHEMA = resultV1Schema;

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
