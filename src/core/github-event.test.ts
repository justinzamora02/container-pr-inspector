import { describe, expect, it } from "vitest";
import {
  inspectionOptionsForPullRequest,
  type PullRequestEvent
} from "./github-event.js";

function event(headRepositoryId: number): PullRequestEvent {
  return {
    number: 42,
    base: {
      sha: "base-sha",
      repo: { id: 1, full_name: "octo/app" }
    },
    head: {
      sha: "head-sha",
      repo: { id: headRepositoryId, full_name: "contributor/app" }
    }
  };
}

describe("pull-request execution mode", () => {
  it("freezes event refs for same-repository comparisons", () => {
    expect(
      inspectionOptionsForPullRequest(event(1), ".container-pr-inspector.yml")
    ).toEqual({
      fork: false,
      options: {
        mode: "compare",
        baseSha: "base-sha",
        headSha: "head-sha",
        configPath: ".container-pr-inspector.yml",
        repository: "octo/app"
      }
    });
  });

  it("routes forks to static-only mode without a base ref", () => {
    expect(
      inspectionOptionsForPullRequest(event(2), ".container-pr-inspector.yml")
    ).toEqual({
      fork: true,
      options: {
        mode: "static",
        headSha: "head-sha",
        configPath: ".container-pr-inspector.yml"
      }
    });
  });
});
