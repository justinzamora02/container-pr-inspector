import { access, constants } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LIMITS } from "./constants.js";
import { InspectorError } from "./errors.js";
import {
  adapterFinding,
  normalizeSeverity,
  type RawFinding
} from "./normalize.js";
import { executableVersion, runCommand } from "./process.js";
import { toolEnvironment } from "./security.js";
import type { AdapterResult, InspectorConfig } from "./types.js";

interface TrivyVulnerability {
  VulnerabilityID?: string;
  PkgName?: string;
  InstalledVersion?: string;
  PkgIdentifier?: { PURL?: string };
  Severity?: string;
  Title?: string;
  Description?: string;
}

interface TrivyMisconfiguration {
  ID?: string;
  AVDID?: string;
  Title?: string;
  Description?: string;
  Severity?: string;
  CauseMetadata?: { Resource?: string; Provider?: string };
}

interface TrivyDocument {
  Results?: Array<{
    Target?: string;
    Vulnerabilities?: TrivyVulnerability[];
    Misconfigurations?: TrivyMisconfiguration[];
  }>;
}

interface CycloneDxComponent {
  type?: string;
  name?: string;
  version?: string;
  purl?: string;
  "bom-ref"?: string;
}

interface CycloneDxDocument {
  components?: CycloneDxComponent[];
}

async function findExecutable(name: string): Promise<string | undefined> {
  const directories = (process.env.PATH ?? "").split(path.delimiter);
  for (const directory of directories) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return undefined;
}

function parseJson(source: string, adapter: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new InspectorError(
      "SCANNER_OUTPUT_INVALID",
      `${adapter} returned malformed JSON`
    );
  }
}

export function trivyVulnerabilities(
  document: TrivyDocument,
  target: string
): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const result of document.Results ?? []) {
    for (const vulnerability of result.Vulnerabilities ?? []) {
      const id = vulnerability.VulnerabilityID ?? "unknown";
      const name = vulnerability.PkgName ?? "unknown";
      const version = vulnerability.InstalledVersion ?? "unknown";
      const purl = vulnerability.PkgIdentifier?.PURL;
      findings.push({
        identity: `vulnerability:${id}:${purl ?? name}:${version}`,
        target,
        kind: "vulnerability",
        severity: normalizeSeverity(vulnerability.Severity),
        title: vulnerability.Title ?? `${id} in ${name}`,
        vulnerabilityId: id,
        package: {
          name,
          version,
          ...(purl ? { purl } : {})
        },
        ...(vulnerability.Description
          ? { message: vulnerability.Description }
          : {})
      });
    }
  }
  return findings;
}

export function trivyMisconfigurations(
  document: TrivyDocument,
  target: string
): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const result of document.Results ?? []) {
    for (const item of result.Misconfigurations ?? []) {
      const id = item.ID ?? item.AVDID ?? item.Title ?? "unknown";
      const resource = item.CauseMetadata?.Resource ?? result.Target ?? "";
      findings.push({
        identity: `misconfiguration:${id}:${resource}`,
        target,
        kind: "misconfiguration",
        severity: normalizeSeverity(item.Severity),
        title: item.Title ?? id,
        ...(item.Description ? { message: item.Description } : {})
      });
    }
  }
  return findings;
}

export function syftPackages(
  document: CycloneDxDocument,
  target: string
): RawFinding[] {
  return (document.components ?? [])
    .filter((component) => component.name)
    .map((component) => {
      const name = component.name ?? "unknown";
      const version = component.version ?? "unknown";
      const identity =
        component.purl ?? component["bom-ref"] ?? `${component.type ?? "library"}:${name}@${version}`;
      return {
        identity: `package:${identity}`,
        target,
        kind: "package" as const,
        severity: "unknown" as const,
        title: `${name}@${version}`,
        package: {
          name,
          version,
          ...(component.purl ? { purl: component.purl } : {})
        }
      };
    });
}

export interface ImageScan {
  vulnerabilities: RawFinding[];
  packages: RawFinding[];
}

export class ScannerSession {
  readonly adapters: AdapterResult[];
  private readonly trivyPath: string | undefined;
  private readonly syftPath: string | undefined;
  private trivyPrepared = false;

  private constructor(
    private readonly config: InspectorConfig,
    trivyPath: string | undefined,
    syftPath: string | undefined,
    adapters: AdapterResult[]
  ) {
    this.trivyPath = trivyPath;
    this.syftPath = syftPath;
    this.adapters = adapters;
  }

  static async create(config: InspectorConfig): Promise<ScannerSession> {
    const [trivyPath, syftPath] = await Promise.all([
      config.scanners.trivy ? findExecutable("trivy") : undefined,
      config.scanners.syft ? findExecutable("syft") : undefined
    ]);
    const adapters: AdapterResult[] = [];
    if (!config.scanners.trivy) {
      adapters.push({ name: "trivy", state: "skipped", reason: "disabled" });
    } else if (!trivyPath) {
      adapters.push({
        name: "trivy",
        state: "skipped",
        reason: "binary not found on PATH"
      });
    } else {
      const version = await executableVersion(trivyPath);
      adapters.push({
        name: "trivy",
        state: "completed",
        ...(version ? { version } : {})
      });
    }
    if (!config.scanners.syft) {
      adapters.push({ name: "syft", state: "skipped", reason: "disabled" });
    } else if (!syftPath) {
      adapters.push({
        name: "syft",
        state: "skipped",
        reason: "binary not found on PATH"
      });
    } else {
      const version = await executableVersion(syftPath);
      adapters.push({
        name: "syft",
        state: "completed",
        ...(version ? { version } : {})
      });
    }
    return new ScannerSession(config, trivyPath, syftPath, adapters);
  }

  private async prepareTrivy(): Promise<void> {
    if (!this.trivyPath || this.trivyPrepared) return;
    await runCommand(
      this.trivyPath,
      ["image", "--download-db-only", "--quiet"],
      {
        cwd: os.tmpdir(),
        timeoutMs: LIMITS.downloadTimeoutMs,
        env: toolEnvironment()
      }
    );
    this.trivyPrepared = true;
    const versionResult = await runCommand(
      this.trivyPath,
      ["version", "--format", "json"],
      {
        cwd: os.tmpdir(),
        timeoutMs: 30_000,
        maxOutputBytes: 256 * 1024,
        env: toolEnvironment(),
        allowFailure: true
      }
    );
    if (versionResult.exitCode === 0) {
      const metadata = parseJson(versionResult.stdout, "trivy version") as {
        VulnerabilityDB?: { Version?: number; UpdatedAt?: string };
      };
      const adapter = this.adapters.find((item) => item.name === "trivy");
      if (adapter && metadata.VulnerabilityDB) {
        adapter.database = {
          ...(metadata.VulnerabilityDB.UpdatedAt
            ? { updatedAt: metadata.VulnerabilityDB.UpdatedAt }
            : {}),
          ...(metadata.VulnerabilityDB.Version !== undefined
            ? { version: String(metadata.VulnerabilityDB.Version) }
            : {})
        };
      }
    }
  }

  async scanImage(reference: string, target: string): Promise<ImageScan> {
    const vulnerabilities: RawFinding[] = [];
    const packages: RawFinding[] = [];
    if (this.trivyPath && this.config.scanners.trivy) {
      await this.prepareTrivy();
      const result = await runCommand(
        this.trivyPath,
        [
          "image",
          "--quiet",
          "--skip-version-check",
          "--skip-db-update",
          "--format",
          "json",
          "--scanners",
          "vuln",
          reference
        ],
        {
          cwd: os.tmpdir(),
          timeoutMs: LIMITS.scanTimeoutMs,
          env: toolEnvironment()
        }
      );
      vulnerabilities.push(
        ...trivyVulnerabilities(
          parseJson(result.stdout, "trivy") as TrivyDocument,
          target
        )
      );
    }
    if (this.syftPath && this.config.scanners.syft) {
      const result = await runCommand(
        this.syftPath,
        [reference, "--output", "cyclonedx-json", "--quiet"],
        {
          cwd: os.tmpdir(),
          timeoutMs: LIMITS.scanTimeoutMs,
          env: toolEnvironment()
        }
      );
      packages.push(
        ...syftPackages(
          parseJson(result.stdout, "syft") as CycloneDxDocument,
          target
        )
      );
    }
    return { vulnerabilities, packages };
  }

  skippedFindings(target: string): RawFinding[] {
    return this.adapters
      .filter((adapter) => adapter.state === "skipped")
      .map((adapter) =>
        adapterFinding(target, adapter.name, adapter.reason ?? "unavailable")
      );
  }

  async scanConfiguration(
    repositoryRoot: string,
    target: string
  ): Promise<RawFinding[]> {
    if (!this.trivyPath || !this.config.scanners.trivy) {
      return this.skippedFindings(target).filter((finding) =>
        finding.identity.includes("trivy")
      );
    }
    const result = await runCommand(
      this.trivyPath,
      [
        "config",
        "--quiet",
        "--skip-version-check",
        "--format",
        "json",
        "--misconfig-scanners",
        "dockerfile",
        repositoryRoot
      ],
      {
        cwd: os.tmpdir(),
        timeoutMs: LIMITS.scanTimeoutMs,
        env: toolEnvironment()
      }
    );
    return trivyMisconfigurations(
      parseJson(result.stdout, "trivy") as TrivyDocument,
      target
    );
  }
}
