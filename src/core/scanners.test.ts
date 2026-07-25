import { describe, expect, it } from "vitest";
import {
  syftPackages,
  trivyMisconfigurations,
  trivyVulnerabilities
} from "./scanners.js";

describe("scanner fixture normalization", () => {
  it("normalizes Trivy vulnerabilities into stable coordinates", () => {
    const findings = trivyVulnerabilities(
      {
        Results: [
          {
            Vulnerabilities: [
              {
                VulnerabilityID: "CVE-2026-1",
                PkgName: "openssl",
                InstalledVersion: "1.0",
                Severity: "HIGH",
                PkgIdentifier: { PURL: "pkg:apk/openssl@1.0" }
              }
            ]
          }
        ]
      },
      "app"
    );
    expect(findings[0]).toMatchObject({
      identity: "vulnerability:CVE-2026-1:pkg:apk/openssl@1.0:1.0",
      severity: "high",
      vulnerabilityId: "CVE-2026-1"
    });
  });

  it("normalizes Syft CycloneDX packages", () => {
    expect(
      syftPackages(
        {
          components: [
            { type: "library", name: "left-pad", version: "1.3.0", purl: "pkg:npm/left-pad@1.3.0" }
          ]
        },
        "app"
      )[0]
    ).toMatchObject({
      identity: "package:pkg:npm/left-pad@1.3.0",
      package: { name: "left-pad", version: "1.3.0" }
    });
  });

  it("normalizes Trivy configuration findings", () => {
    expect(
      trivyMisconfigurations(
        {
          Results: [
            {
              Target: "Dockerfile",
              Misconfigurations: [
                { ID: "DS001", Title: "Root user", Severity: "HIGH" }
              ]
            }
          ]
        },
        "app"
      )[0]
    ).toMatchObject({
      identity: "misconfiguration:DS001:Dockerfile",
      kind: "misconfiguration",
      severity: "high"
    });
  });
});
