import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  loadConfig,
  resolveTargetPaths
} from "./core/config.js";
import {
  buildImage,
  dockerVersion,
  pullAndVerifyBase,
  resolveDockerPlatform
} from "./core/docker.js";
import { ConfigurationError, InspectorError } from "./core/errors.js";
import {
  findRepositoryRoot,
  materializeRef,
  resolveRepositoryName,
  type MaterializedRef
} from "./core/git.js";
import {
  calculateDelta,
  sbomSummary,
  vulnerabilitySummary,
  type RawFinding
} from "./core/normalize.js";
import { aggregatePolicy, evaluateTargetPolicy } from "./core/policy.js";
import { ScannerSession } from "./core/scanners.js";
import { inspectDockerfileStatically } from "./core/static.js";
import { expandImageTemplate, parseRepository } from "./core/template.js";
import type {
  AdapterResult,
  Conclusion,
  InspectionOptions,
  InspectionResult,
  PolicyResult,
  TargetResult
} from "./core/types.js";
import { WORKTREE } from "./core/constants.js";
import { sanitizeText } from "./core/security.js";

function errorConclusion(code: string): Conclusion {
  if (code === "CONFIG_ERROR") return "config-error";
  if (code.includes("BASE_BUILD")) return "base-build-failed";
  if (code.includes("HEAD_BUILD")) return "head-build-failed";
  if (code.includes("SCANNER")) return "scanner-failed";
  return "base-resolution-failed";
}

function policyPlaceholder(status: PolicyResult["status"] = "passed"): PolicyResult {
  return { reportOnly: true, status, evaluations: [] };
}

function emptyResult(options: InspectionOptions, startedAt: string): InspectionResult {
  const head =
    options.mode === "audit"
      ? options.ref
      : options.headSha;
  return {
    schemaVersion: 1,
    run: {
      id: randomUUID(),
      mode: options.mode,
      startedAt,
      finishedAt: new Date().toISOString(),
      ...(options.repository ? { repository: options.repository } : {}),
      ...(options.mode === "compare" ? { baseSha: options.baseSha } : {}),
      headSha: head
    },
    tools: {
      inspectorVersion: options.inspectorVersion ?? "development",
      nodeVersion: process.version,
      adapters: []
    },
    targets: [],
    policy: policyPlaceholder(options.mode === "static" ? "neutral" : "passed"),
    conclusion: options.mode === "static" ? "neutral" : "passed",
    warnings: []
  };
}

export function failureResult(
  options: InspectionOptions,
  error: unknown,
  startedAt = new Date().toISOString()
): InspectionResult {
  const result = emptyResult(options, startedAt);
  const code = error instanceof InspectorError ? error.code : "UNEXPECTED_ERROR";
  const message = sanitizeText(
    error instanceof Error ? error.message : String(error)
  );
  result.conclusion = errorConclusion(code);
  result.warnings.push(`${code}: ${message}`);
  result.run.finishedAt = new Date().toISOString();
  return result;
}

async function targetExists(
  loaded: Awaited<ReturnType<typeof loadConfig>>,
  target: Awaited<ReturnType<typeof loadConfig>>["config"]["targets"][number],
  worktreeRoot: string
): Promise<boolean> {
  const paths = resolveTargetPaths(loaded, target, worktreeRoot);
  try {
    await Promise.all([access(paths.dockerfile), access(paths.context)]);
    return true;
  } catch {
    return false;
  }
}

function staticAdapters(session: ScannerSession): AdapterResult[] {
  return [
    { name: "dockerfile", state: "completed", version: "v1" },
    ...session.adapters.map((adapter) =>
      adapter.name === "syft"
        ? {
            name: "syft" as const,
            state: "skipped" as const,
            reason: "fork-isolation"
          }
        : adapter
    )
  ];
}

function targetFailure(
  target: TargetResult,
  code: string,
  error: unknown
): void {
  const message = sanitizeText(
    error instanceof Error ? error.message : String(error)
  );
  if (
    !target.error ||
    code.startsWith("HEAD_BUILD") ||
    (!target.error.code.startsWith("BASE_BUILD") && code.startsWith("BASE_BUILD"))
  ) {
    target.error = { code, message };
  }
  target.warnings.push(`${code}: ${message}`);
}

function operationalConclusion(targets: TargetResult[]): Conclusion | undefined {
  const codes = targets
    .map((target) => target.error?.code)
    .filter((code): code is string => Boolean(code));
  if (codes.some((code) => code.startsWith("HEAD_BUILD"))) {
    return "head-build-failed";
  }
  if (codes.some((code) => code.startsWith("BASE_BUILD"))) {
    return "base-build-failed";
  }
  if (codes.some((code) => code.startsWith("SCANNER"))) {
    return "scanner-failed";
  }
  return undefined;
}

export async function inspect(options: InspectionOptions): Promise<InspectionResult> {
  const startedAt = new Date().toISOString();
  const seed = emptyResult(options, startedAt);
  let headRef: MaterializedRef | undefined;
  let baseRef: MaterializedRef | undefined;

  try {
    const repositoryRoot = await findRepositoryRoot();
    const loaded = await loadConfig(options.configPath, repositoryRoot);
    const repositoryName = await resolveRepositoryName(
      repositoryRoot,
      options.repository
    );
    const needsRepository =
      options.mode === "compare" &&
      loaded.config.targets.some((target) =>
        /\$\{(?:owner|repo)\}/.test(target.baseImage)
      );
    if (needsRepository && !repositoryName) {
      throw new ConfigurationError(
        "repository is required because baseImage uses owner or repo"
      );
    }
    const repository = repositoryName
      ? parseRepository(repositoryName)
      : undefined;

    const requestedHead = options.mode === "audit" ? options.ref : options.headSha;
    headRef = await materializeRef(repositoryRoot, requestedHead);
    seed.run.headSha = headRef.sha;
    if (repositoryName) seed.run.repository = repositoryName;

    if (options.mode === "compare") {
      baseRef = await materializeRef(repositoryRoot, options.baseSha);
      seed.run.baseSha = baseRef.sha;
    }

    const scannerSession = await ScannerSession.create(loaded.config);
    seed.tools.adapters = scannerSession.adapters;

    if (options.mode === "static") {
      seed.tools.adapters = staticAdapters(scannerSession);
      for (const target of loaded.config.targets) {
        const result: TargetResult = {
          name: target.name,
          configuration: target,
          head: { sha: headRef.sha },
          adapters: staticAdapters(scannerSession),
          sbom: {},
          vulnerabilities: {},
          findings: [],
          policy: policyPlaceholder("neutral"),
          warnings: []
        };
        try {
          const [dockerfile, trivyFindings] = await Promise.all([
            inspectDockerfileStatically(loaded, target),
            scannerSession.scanConfiguration(headRef.root, target.name)
          ]);
          const raw = [...dockerfile.findings, ...trivyFindings];
          result.findings = calculateDelta([], raw);
        } catch (error) {
          targetFailure(result, "SCANNER_STATIC_FAILED", error);
        }
        result.policy = evaluateTargetPolicy(loaded.config, result, "static");
        seed.targets.push(result);
      }
      seed.policy = aggregatePolicy(
        seed.targets.map((target) => target.policy),
        "static"
      );
      seed.conclusion = operationalConclusion(seed.targets) ?? "neutral";
    } else {
      const platform = await resolveDockerPlatform();
      seed.run.platform = platform;
      const docker = await dockerVersion();
      if (docker) {
        seed.tools.adapters.unshift({
          name: "docker",
          state: "completed",
          version: `docker ${docker}`
        });
      }

      for (const target of loaded.config.targets) {
        const result: TargetResult = {
          name: target.name,
          configuration: target,
          head: { sha: headRef.sha },
          adapters: scannerSession.adapters.map((adapter) => ({ ...adapter })),
          sbom: {},
          vulnerabilities: {},
          findings: [],
          policy: policyPlaceholder(),
          warnings: []
        };
        if (options.mode === "compare" && baseRef) {
          result.base = {
            sha: baseRef.sha,
            source: "none",
            verification: "not-applicable"
          };
        }

        let baseRaw: RawFinding[] = [];
        let headRaw: RawFinding[] = [];
        try {
          if (options.mode === "compare" && baseRef) {
            const baseReference = expandImageTemplate(target.baseImage, {
              owner: repository?.owner ?? "",
              repo: repository?.repo ?? "",
              sha: baseRef.sha
            });
            const remote = await pullAndVerifyBase(
              baseReference,
              baseRef.sha,
              platform
            );
            if (remote.accepted) {
              result.base = {
                sha: baseRef.sha,
                source: "registry",
                verification: "verified",
                image: remote.image
              };
            } else {
              const warning = `${baseReference} rejected: ${remote.message}`;
              result.warnings.push(warning);
              if (await targetExists(loaded, target, baseRef.root)) {
                try {
                  const image = await buildImage({
                    loaded,
                    target,
                    worktreeRoot: baseRef.root,
                    side: "base",
                    sha: baseRef.sha,
                    platform
                  });
                  result.base = {
                    sha: baseRef.sha,
                    source: "build-fallback",
                    verification: remote.verification,
                    verificationMessage: remote.message,
                    image
                  };
                } catch (error) {
                  targetFailure(result, "BASE_BUILD_FAILED", error);
                }
              } else {
                result.base = {
                  sha: baseRef.sha,
                  source: "none",
                  verification: "not-applicable",
                  verificationMessage: "target does not exist at the base commit"
                };
                result.warnings.push("target does not exist at the base commit");
              }
            }
          }

          try {
            result.head = {
              sha: headRef.sha,
              image: await buildImage({
                loaded,
                target,
                worktreeRoot: headRef.root,
                side: "head",
                sha: headRef.sha,
                platform
              })
            };
          } catch (error) {
            targetFailure(result, "HEAD_BUILD_FAILED", error);
          }

          if (!result.error || result.error.code === "BASE_BUILD_FAILED") {
            try {
              if (result.base?.image) {
                const scan = await scannerSession.scanImage(
                  result.base.image.reference,
                  target.name
                );
                baseRaw = [...scan.vulnerabilities, ...scan.packages];
                result.vulnerabilities.base = vulnerabilitySummary(
                  scan.vulnerabilities
                );
                result.sbom.base = sbomSummary(scan.packages);
              }
              if (result.head?.image) {
                const scan = await scannerSession.scanImage(
                  result.head.image.reference,
                  target.name
                );
                headRaw = [
                  ...scan.vulnerabilities,
                  ...scan.packages,
                  ...scannerSession.skippedFindings(target.name)
                ];
                result.vulnerabilities.head = vulnerabilitySummary(
                  scan.vulnerabilities
                );
                result.sbom.head = sbomSummary(scan.packages);
              }
            } catch (error) {
              targetFailure(result, "SCANNER_FAILED", error);
            }
          }
        } catch (error) {
          targetFailure(result, "BASE_RESOLUTION_FAILED", error);
        }

        result.findings = calculateDelta(baseRaw, headRaw);
        result.adapters = scannerSession.adapters.map((adapter) => ({ ...adapter }));
        result.policy = evaluateTargetPolicy(loaded.config, result, options.mode);
        seed.targets.push(result);
      }

      seed.policy = aggregatePolicy(
        seed.targets.map((target) => target.policy),
        options.mode
      );
      const operational = operationalConclusion(seed.targets);
      if (operational) seed.conclusion = operational;
      else if (seed.policy.status === "failed") seed.conclusion = "policy-failed";
      else if (seed.targets.some((target) => target.warnings.length > 0)) {
        seed.conclusion = "passed-with-warnings";
      } else seed.conclusion = "passed";
    }

    seed.warnings = [
      ...new Set(seed.targets.flatMap((target) => target.warnings))
    ];
    seed.run.finishedAt = new Date().toISOString();
    return seed;
  } catch (error) {
    return failureResult(options, error, startedAt);
  } finally {
    await Promise.allSettled([headRef?.cleanup(), baseRef?.cleanup()]);
  }
}

export function exitCodeFor(result: InspectionResult): 0 | 1 | 2 {
  if (result.conclusion === "policy-failed") return 1;
  if (
    [
      "config-error",
      "base-resolution-failed",
      "base-build-failed",
      "head-build-failed",
      "scanner-failed",
      "reporting-failed"
    ].includes(result.conclusion)
  ) {
    return 2;
  }
  return 0;
}

export { WORKTREE };
