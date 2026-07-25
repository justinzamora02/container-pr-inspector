export const LIMITS = {
  buildTimeoutMs: 20 * 60 * 1000,
  scanTimeoutMs: 10 * 60 * 1000,
  downloadTimeoutMs: 2 * 60 * 1000,
  commandOutputBytes: 10 * 1024 * 1024,
  jsonBytes: 20 * 1024 * 1024,
  commentBytes: 60 * 1024,
  summaryBytes: 900 * 1024
} as const;

export const COMMENT_MARKER = "<!-- container-pr-inspector:v1 -->";
export const WORKTREE = "WORKTREE";
