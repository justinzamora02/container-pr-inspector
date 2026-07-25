import { describe, expect, it } from "vitest";
import {
  calculateDelta,
  stableFindingId,
  vulnerabilitySummary,
  type RawFinding
} from "./normalize.js";

function finding(identity: string, severity: RawFinding["severity"] = "high") {
  return {
    identity,
    target: "app",
    kind: "vulnerability" as const,
    severity,
    title: identity
  };
}

describe("finding normalization", () => {
  it("marks new, resolved, and unchanged findings deterministically", () => {
    const delta = calculateDelta(
      [finding("resolved"), finding("same")],
      [finding("new"), finding("same")]
    );
    expect(delta.map(({ identity, status }) => ({ identity, status }))).toEqual([
      { identity: "new", status: "new" },
      { identity: "resolved", status: "resolved" },
      { identity: "same", status: "unchanged" }
    ]);
  });

  it("does not include status in stable IDs", () => {
    const raw = finding("CVE-1");
    const [first] = calculateDelta([], [raw]);
    const [second] = calculateDelta([raw], [raw]);
    expect(first?.id).toBe(second?.id);
    expect(first?.id).toBe(stableFindingId(raw));
  });

  it("summarizes every normalized severity", () => {
    expect(
      vulnerabilitySummary([finding("a", "critical"), finding("b", "unknown")])
    ).toEqual({
      total: 2,
      bySeverity: {
        critical: 1,
        high: 0,
        medium: 0,
        low: 0,
        unknown: 1
      }
    });
  });
});
