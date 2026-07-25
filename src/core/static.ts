import { readFile } from "node:fs/promises";
import { resolveTargetPaths } from "./config.js";
import type { RawFinding } from "./normalize.js";
import type { LoadedConfig, TargetConfig } from "./types.js";

interface StaticDockerfile {
  user: string;
  hasHealthcheck: boolean;
  findings: RawFinding[];
}

function logicalLines(source: string): string[] {
  return source
    .replace(/\\\r?\n/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export async function inspectDockerfileStatically(
  loaded: LoadedConfig,
  target: TargetConfig
): Promise<StaticDockerfile> {
  const { dockerfile } = resolveTargetPaths(loaded, target);
  const source = await readFile(dockerfile, "utf8");
  const lines = logicalLines(source);
  let user = "";
  let hasHealthcheck = false;
  let stage = 0;

  for (const line of lines) {
    const [instruction = "", ...rest] = line.split(/\s+/);
    const value = rest.join(" ").trim();
    switch (instruction.toUpperCase()) {
      case "FROM":
        stage += 1;
        user = "";
        hasHealthcheck = false;
        break;
      case "USER":
        user = value;
        break;
      case "HEALTHCHECK":
        hasHealthcheck = value.toUpperCase() !== "NONE";
        break;
      default:
        break;
    }
  }

  const findings: RawFinding[] = [];
  const normalizedUser = user.split(":", 1)[0]?.trim().toLowerCase() ?? "";
  if (normalizedUser === "" || normalizedUser === "root" || normalizedUser === "0") {
    findings.push({
      identity: "misconfiguration:dockerfile:root-user",
      target: target.name,
      kind: "misconfiguration",
      severity: "high",
      title: "Final Dockerfile stage may run as root",
      message:
        stage === 0
          ? "No FROM instruction was found."
          : "The final stage has no non-root USER instruction."
    });
  }
  if (!hasHealthcheck) {
    findings.push({
      identity: "misconfiguration:dockerfile:missing-healthcheck",
      target: target.name,
      kind: "misconfiguration",
      severity: "low",
      title: "Final Dockerfile stage has no HEALTHCHECK"
    });
  }
  return { user, hasHealthcheck, findings };
}
