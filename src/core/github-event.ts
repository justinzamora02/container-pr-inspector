import type { InspectionOptions } from "./types.js";

export interface PullRequestEvent {
  number: number;
  base: {
    sha: string;
    repo: { id: number; full_name: string };
  };
  head: {
    sha: string;
    repo: { id: number; full_name: string };
  };
}

export function inspectionOptionsForPullRequest(
  request: PullRequestEvent,
  configPath: string
): { fork: boolean; options: InspectionOptions } {
  const fork = request.head.repo.id !== request.base.repo.id;
  return {
    fork,
    options: fork
      ? {
          mode: "static",
          headSha: request.head.sha,
          configPath
        }
      : {
          mode: "compare",
          baseSha: request.base.sha,
          headSha: request.head.sha,
          configPath,
          repository: request.base.repo.full_name
        }
  };
}
