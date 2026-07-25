import { describe, expect, it } from "vitest";
import { buildCommentBody, findOwnedComment } from "./reporting.js";
import { COMMENT_MARKER, LIMITS } from "./constants.js";
import type { InspectionResult } from "./types.js";

const result: InspectionResult = {
  schemaVersion: 1,
  run: {
    id: "run",
    mode: "static",
    startedAt: "2026-07-25T00:00:00.000Z",
    finishedAt: "2026-07-25T00:00:01.000Z",
    headSha: "abc"
  },
  tools: {
    inspectorVersion: "1.0.0",
    nodeVersion: "v24.0.0",
    adapters: []
  },
  targets: [],
  policy: { reportOnly: true, status: "neutral", evaluations: [] },
  conclusion: "neutral",
  warnings: [],
};

describe("GitHub comment reporting", () => {
  it("only selects bot-owned marker comments", () => {
    expect(
      findOwnedComment([
        { id: 1, body: COMMENT_MARKER, user: { type: "User" } },
        { id: 2, body: COMMENT_MARKER, user: { type: "Bot" } }
      ])?.id
    ).toBe(2);
  });

  it("keeps the marker and respects the comment byte cap", () => {
    const body = buildCommentBody({
      ...result,
      warnings: ["x".repeat(LIMITS.commentBytes * 2)]
    });
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(LIMITS.commentBytes);
  });
});
