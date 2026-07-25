export const SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "unknown"
] as const;

export type Severity = (typeof SEVERITIES)[number];
export type FindingStatus = "new" | "resolved" | "unchanged";
export type RunMode = "compare" | "audit" | "static";
export type Conclusion =
  | "passed"
  | "passed-with-warnings"
  | "neutral"
  | "policy-failed"
  | "config-error"
  | "base-resolution-failed"
  | "base-build-failed"
  | "head-build-failed"
  | "scanner-failed"
  | "reporting-failed";

export interface BuildConfig {
  target?: string;
  args: Record<string, string>;
}

export interface TargetConfig {
  name: string;
  dockerfile: string;
  context: string;
  baseImage: string;
  build: BuildConfig;
}

export interface ScannerConfig {
  trivy: boolean;
  syft: boolean;
}

export interface GateConfig {
  imageSize?: {
    maxIncreaseBytes?: number;
    maxIncreasePercent?: number;
  };
  vulnerabilities?: {
    maxNew: Partial<Record<Severity, number>>;
  };
  disallowRoot?: boolean;
  requireHealthcheck?: boolean;
}

export interface InspectorConfig {
  version: 1;
  targets: TargetConfig[];
  scanners: ScannerConfig;
  gates: GateConfig;
}

export interface LoadedConfig {
  config: InspectorConfig;
  configPath: string;
  repositoryRoot: string;
}

export interface Platform {
  os: string;
  architecture: string;
  variant?: string;
}

export interface HealthcheckMetadata {
  test: string[];
  interval?: number;
  timeout?: number;
  retries?: number;
  startPeriod?: number;
}

export interface ImageMetadata {
  reference: string;
  digest?: string;
  imageId: string;
  revision?: string;
  platform: Platform;
  sizeBytes: number;
  layers: string[];
  user: string;
  healthcheck?: HealthcheckMetadata;
}

export type AdapterState = "completed" | "skipped" | "failed";

export interface AdapterResult {
  name: "docker" | "trivy" | "syft" | "dockerfile";
  state: AdapterState;
  version?: string;
  reason?: string;
  database?: {
    updatedAt?: string;
    version?: string;
  };
}

export interface NormalizedFinding {
  id: string;
  identity: string;
  target: string;
  kind: "vulnerability" | "package" | "misconfiguration" | "adapter";
  status: FindingStatus;
  severity: Severity;
  title: string;
  vulnerabilityId?: string;
  package?: {
    name: string;
    version: string;
    purl?: string;
  };
  message?: string;
}

export interface SbomSummary {
  format: "CycloneDX";
  componentCount: number;
}

export interface VulnerabilitySummary {
  total: number;
  bySeverity: Record<Severity, number>;
}

export type GateStatus = "passed" | "failed" | "not-evaluated";

export interface GateEvaluation {
  gate: string;
  status: GateStatus;
  actual?: number | string | boolean;
  limit?: number | string | boolean;
  reason?: string;
}

export interface PolicyResult {
  reportOnly: boolean;
  status: "passed" | "failed" | "neutral";
  evaluations: GateEvaluation[];
}

export interface TargetResult {
  name: string;
  configuration: TargetConfig;
  base?: {
    sha?: string;
    source: "registry" | "build-fallback" | "none";
    verification:
      | "verified"
      | "not-found"
      | "pull-failed"
      | "missing-digest"
      | "missing-revision"
      | "revision-mismatch"
      | "not-applicable";
    verificationMessage?: string;
    image?: ImageMetadata;
  };
  head?: {
    sha: string;
    image?: ImageMetadata;
  };
  adapters: AdapterResult[];
  sbom: {
    base?: SbomSummary;
    head?: SbomSummary;
  };
  vulnerabilities: {
    base?: VulnerabilitySummary;
    head?: VulnerabilitySummary;
  };
  findings: NormalizedFinding[];
  policy: PolicyResult;
  warnings: string[];
  error?: {
    code: string;
    message: string;
  };
}

export interface InspectionResult {
  schemaVersion: 1;
  run: {
    id: string;
    mode: RunMode;
    startedAt: string;
    finishedAt: string;
    repository?: string;
    baseSha?: string;
    headSha: string;
    platform?: Platform;
  };
  tools: {
    inspectorVersion: string;
    nodeVersion: string;
    adapters: AdapterResult[];
  };
  targets: TargetResult[];
  policy: PolicyResult;
  conclusion: Conclusion;
  warnings: string[];
}

export interface CompareOptions {
  mode: "compare";
  baseSha: string;
  headSha: string;
  configPath: string;
  repository?: string;
  inspectorVersion?: string;
}

export interface AuditOptions {
  mode: "audit";
  ref: string;
  configPath: string;
  repository?: string;
  inspectorVersion?: string;
}

export interface StaticOptions {
  mode: "static";
  headSha: string;
  configPath: string;
  repository?: string;
  inspectorVersion?: string;
}

export type InspectionOptions = CompareOptions | AuditOptions | StaticOptions;
