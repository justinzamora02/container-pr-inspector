import { configuredSeverities } from "./config.js";
import type {
  GateEvaluation,
  InspectorConfig,
  PolicyResult,
  TargetResult
} from "./types.js";

function hasConfiguredGates(config: InspectorConfig): boolean {
  return (
    config.gates.disallowRoot ||
      config.gates.requireHealthcheck ||
      config.gates.imageSize?.maxIncreaseBytes !== undefined ||
      config.gates.imageSize?.maxIncreasePercent !== undefined ||
      configuredSeverities(config).length > 0
  );
}

function effectiveRoot(user: string): boolean {
  const principal = user.split(":", 1)[0]?.trim().toLowerCase() ?? "";
  return principal === "" || principal === "root" || principal === "0";
}

function hasHealthcheck(target: TargetResult): boolean {
  const test = target.head?.image?.healthcheck?.test;
  return Boolean(test && test.length > 0 && test[0]?.toUpperCase() !== "NONE");
}

function unavailable(gate: string, reason: string): GateEvaluation {
  return { gate, status: "not-evaluated", reason };
}

export function evaluateTargetPolicy(
  config: InspectorConfig,
  target: TargetResult,
  mode: "compare" | "audit" | "static"
): PolicyResult {
  const reportOnly = !hasConfiguredGates(config);
  if (mode === "static") {
    const evaluations: GateEvaluation[] = [];
    if (config.gates.imageSize?.maxIncreaseBytes !== undefined) {
      evaluations.push(unavailable("imageSize.maxIncreaseBytes", "fork-isolation"));
    }
    if (config.gates.imageSize?.maxIncreasePercent !== undefined) {
      evaluations.push(
        unavailable("imageSize.maxIncreasePercent", "fork-isolation")
      );
    }
    for (const [severity] of configuredSeverities(config)) {
      evaluations.push(
        unavailable(`vulnerabilities.maxNew.${severity}`, "fork-isolation")
      );
    }
    if (config.gates.disallowRoot) {
      evaluations.push(unavailable("disallowRoot", "fork-isolation"));
    }
    if (config.gates.requireHealthcheck) {
      evaluations.push(unavailable("requireHealthcheck", "fork-isolation"));
    }
    return { reportOnly, status: "neutral", evaluations };
  }

  const evaluations: GateEvaluation[] = [];
  const baseSize = target.base?.image?.sizeBytes;
  const headSize = target.head?.image?.sizeBytes;
  const sizeUnavailable = baseSize === undefined || headSize === undefined;

  const bytesLimit = config.gates.imageSize?.maxIncreaseBytes;
  if (bytesLimit !== undefined) {
    if (sizeUnavailable) {
      evaluations.push(
        unavailable("imageSize.maxIncreaseBytes", "base or head image unavailable")
      );
    } else {
      const actual = headSize - baseSize;
      evaluations.push({
        gate: "imageSize.maxIncreaseBytes",
        status: actual <= bytesLimit ? "passed" : "failed",
        actual,
        limit: bytesLimit
      });
    }
  }

  const percentLimit = config.gates.imageSize?.maxIncreasePercent;
  if (percentLimit !== undefined) {
    if (sizeUnavailable || baseSize === 0) {
      evaluations.push(
        unavailable(
          "imageSize.maxIncreasePercent",
          baseSize === 0 ? "base image size is zero" : "base or head image unavailable"
        )
      );
    } else {
      const actual = ((headSize - baseSize) / baseSize) * 100;
      evaluations.push({
        gate: "imageSize.maxIncreasePercent",
        status: actual <= percentLimit ? "passed" : "failed",
        actual,
        limit: percentLimit
      });
    }
  }

  const trivy = target.adapters.find((adapter) => adapter.name === "trivy");
  for (const [severity, limit] of configuredSeverities(config)) {
    if (trivy?.state !== "completed") {
      evaluations.push(
        unavailable(
          `vulnerabilities.maxNew.${severity}`,
          trivy?.reason ?? "trivy unavailable"
        )
      );
      continue;
    }
    if (!target.base?.image && mode === "compare") {
      evaluations.push(
        unavailable(
          `vulnerabilities.maxNew.${severity}`,
          "base image unavailable"
        )
      );
      continue;
    }
    if (mode === "audit") {
      evaluations.push(
        unavailable(
          `vulnerabilities.maxNew.${severity}`,
          "audit has no comparison baseline"
        )
      );
      continue;
    }
    const actual = target.findings.filter(
      (finding) =>
        finding.kind === "vulnerability" &&
        finding.status === "new" &&
        finding.severity === severity
    ).length;
    evaluations.push({
      gate: `vulnerabilities.maxNew.${severity}`,
      status: actual <= limit ? "passed" : "failed",
      actual,
      limit
    });
  }

  if (config.gates.disallowRoot) {
    const user = target.head?.image?.user;
    if (user === undefined) {
      evaluations.push(unavailable("disallowRoot", "head image unavailable"));
    } else {
      const root = effectiveRoot(user);
      evaluations.push({
        gate: "disallowRoot",
        status: root ? "failed" : "passed",
        actual: root,
        limit: false
      });
    }
  }

  if (config.gates.requireHealthcheck) {
    if (!target.head?.image) {
      evaluations.push(unavailable("requireHealthcheck", "head image unavailable"));
    } else {
      const present = hasHealthcheck(target);
      evaluations.push({
        gate: "requireHealthcheck",
        status: present ? "passed" : "failed",
        actual: present,
        limit: true
      });
    }
  }

  return {
    reportOnly,
    status:
      evaluations.some(
        (evaluation) =>
          evaluation.status === "failed" ||
          evaluation.status === "not-evaluated"
      ) && !reportOnly
        ? "failed"
        : "passed",
    evaluations
  };
}

export function aggregatePolicy(
  policies: PolicyResult[],
  mode: "compare" | "audit" | "static"
): PolicyResult {
  const evaluations = policies.flatMap((policy) => policy.evaluations);
  const reportOnly = policies.every((policy) => policy.reportOnly);
  if (mode === "static") {
    return { reportOnly, status: "neutral", evaluations };
  }
  return {
    reportOnly,
    status: policies.some((policy) => policy.status === "failed")
      ? "failed"
      : "passed",
    evaluations
  };
}
