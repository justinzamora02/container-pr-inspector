import { createHash } from "node:crypto";
import type {
  NormalizedFinding,
  Severity,
  SbomSummary,
  VulnerabilitySummary
} from "./types.js";
import { SEVERITIES } from "./types.js";

export interface RawFinding {
  identity: string;
  target: string;
  kind: NormalizedFinding["kind"];
  severity: Severity;
  title: string;
  vulnerabilityId?: string;
  package?: NormalizedFinding["package"];
  message?: string;
}

export function normalizeSeverity(value: unknown): Severity {
  if (typeof value !== "string") return "unknown";
  const normalized = value.toLowerCase();
  return SEVERITIES.includes(normalized as Severity)
    ? (normalized as Severity)
    : "unknown";
}

export function stableFindingId(finding: RawFinding): string {
  return createHash("sha256")
    .update(`v1\0${finding.target}\0${finding.kind}\0${finding.identity}`)
    .digest("hex")
    .slice(0, 24);
}

function withStatus(
  finding: RawFinding,
  status: NormalizedFinding["status"]
): NormalizedFinding {
  return {
    id: stableFindingId(finding),
    identity: finding.identity,
    target: finding.target,
    kind: finding.kind,
    status,
    severity: finding.severity,
    title: finding.title,
    ...(finding.vulnerabilityId
      ? { vulnerabilityId: finding.vulnerabilityId }
      : {}),
    ...(finding.package ? { package: finding.package } : {}),
    ...(finding.message ? { message: finding.message } : {})
  };
}

export function calculateDelta(
  base: RawFinding[],
  head: RawFinding[]
): NormalizedFinding[] {
  const baseMap = new Map(base.map((finding) => [finding.identity, finding]));
  const headMap = new Map(head.map((finding) => [finding.identity, finding]));
  const result: NormalizedFinding[] = [];

  for (const identity of [...new Set([...baseMap.keys(), ...headMap.keys()])].sort()) {
    const baseFinding = baseMap.get(identity);
    const headFinding = headMap.get(identity);
    if (headFinding && baseFinding) result.push(withStatus(headFinding, "unchanged"));
    else if (headFinding) result.push(withStatus(headFinding, "new"));
    else if (baseFinding) result.push(withStatus(baseFinding, "resolved"));
  }
  return result;
}

export function vulnerabilitySummary(
  findings: RawFinding[]
): VulnerabilitySummary {
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0
  };
  for (const finding of findings) {
    if (finding.kind === "vulnerability") bySeverity[finding.severity] += 1;
  }
  return {
    total: Object.values(bySeverity).reduce((sum, value) => sum + value, 0),
    bySeverity
  };
}

export function sbomSummary(findings: RawFinding[]): SbomSummary {
  return {
    format: "CycloneDX",
    componentCount: findings.filter((finding) => finding.kind === "package").length
  };
}

export function adapterFinding(
  target: string,
  adapter: string,
  message: string
): RawFinding {
  return {
    identity: `adapter:${adapter}`,
    target,
    kind: "adapter",
    severity: "unknown",
    title: `${adapter} adapter skipped`,
    message
  };
}
