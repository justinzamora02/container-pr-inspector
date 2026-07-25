import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { VERSION } from "./version.js";

describe("VERSION", () => {
  it("matches the package version", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { version: string };

    expect(VERSION).toBe(packageJson.version);
  });

  it("has its package metadata synchronized before release verification", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8"
    );
    const synchronizationStep = workflow.indexOf(
      "name: Synchronize release metadata"
    );
    const verificationStep = workflow.indexOf("name: Verify");

    expect(synchronizationStep).toBeGreaterThan(-1);
    expect(synchronizationStep).toBeLessThan(verificationStep);
    expect(workflow).toContain('release_version="${RELEASE_TAG#v}"');
    expect(workflow).toContain(
      'npm version "$release_version" \\\n'
    );
    expect(workflow).toContain("git add package.json");
    expect(workflow).not.toContain("git add package.json src/version.ts");
  });
});
