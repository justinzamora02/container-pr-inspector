import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectDockerfileStatically } from "./static.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

function fixture(name: string): string {
  return path.join(repositoryRoot, "tests/fixtures/docker", name);
}

describe("inspectDockerfileStatically fixtures", () => {
  it("accepts a non-root image with a health check", async () => {
    const result = await inspectDockerfileStatically(
      fixture("nonroot-healthcheck.Dockerfile"),
      "app"
    );

    expect(result).toMatchObject({
      user: "10001",
      hasHealthcheck: true,
      findings: []
    });
  });

  it("reports root execution and a missing health check", async () => {
    const result = await inspectDockerfileStatically(
      fixture("root-no-healthcheck.Dockerfile"),
      "app"
    );

    expect(result.findings.map((finding) => finding.identity)).toEqual([
      "misconfiguration:dockerfile:root-user",
      "misconfiguration:dockerfile:missing-healthcheck"
    ]);
  });

  it("uses the final stage of a multi-stage Dockerfile", async () => {
    const result = await inspectDockerfileStatically(
      fixture("multistage.Dockerfile"),
      "app"
    );

    expect(result).toMatchObject({
      user: "10001",
      hasHealthcheck: true,
      findings: []
    });
  });
});
