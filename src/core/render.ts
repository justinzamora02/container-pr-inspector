import { LIMITS } from "./constants.js";
import { escapeMarkdown, sanitizeText, truncateUtf8 } from "./security.js";
import { validateResult } from "./schema.js";
import type { InspectionResult, TargetResult } from "./types.js";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stable(nested)])
    );
  }
  return value;
}

export function renderJson(result: InspectionResult): string {
  validateResult(result);
  const rendered = `${JSON.stringify(stable(result), null, 2)}\n`;
  if (Buffer.byteLength(rendered) > LIMITS.jsonBytes) {
    throw new Error(`JSON result exceeds ${LIMITS.jsonBytes} bytes`);
  }
  return rendered;
}

function targetLine(target: TargetResult): string {
  const newFindings = target.findings.filter((finding) => finding.status === "new");
  const sizeDelta =
    target.base?.image && target.head?.image
      ? target.head.image.sizeBytes - target.base.image.sizeBytes
      : undefined;
  return [
    target.name,
    `policy=${target.policy.status}`,
    `new=${newFindings.length}`,
    ...(sizeDelta === undefined ? [] : [`sizeDelta=${sizeDelta}`])
  ].join(" ");
}

export function renderTerminal(result: InspectionResult): string {
  const lines = [
    `Container PR Inspector: ${result.conclusion}`,
    `mode=${result.run.mode} head=${result.run.headSha}${
      result.run.baseSha ? ` base=${result.run.baseSha}` : ""
    }`,
    ...result.targets.map(targetLine)
  ];
  for (const warning of result.warnings) lines.push(`warning: ${sanitizeText(warning)}`);
  return `${lines.join("\n")}\n`;
}

export function renderMarkdown(result: InspectionResult): string {
  const lines = [
    "## Container PR Inspector",
    "",
    `**Conclusion:** \`${result.conclusion}\``,
    "",
    "| Target | Policy | New findings | Base digest |",
    "| --- | --- | ---: | --- |"
  ];
  for (const target of result.targets) {
    const newCount = target.findings.filter(
      (finding) => finding.status === "new"
    ).length;
    lines.push(
      `| ${escapeMarkdown(target.name)} | ${target.policy.status} | ${newCount} | ${
        target.base?.image?.digest
          ? `\`${escapeMarkdown(target.base.image.digest)}\``
          : "n/a"
      } |`
    );
  }
  if (result.warnings.length > 0) {
    lines.push("", "### Warnings", "");
    for (const warning of result.warnings) {
      lines.push(`- ${escapeMarkdown(warning)}`);
    }
  }
  return truncateUtf8(`${lines.join("\n")}\n`, LIMITS.summaryBytes);
}
