import { COMMENT_MARKER, LIMITS } from "./constants.js";
import { renderMarkdown } from "./render.js";
import { truncateUtf8 } from "./security.js";
import type { InspectionResult } from "./types.js";

export interface CommentSummary {
  id: number;
  body?: string | null;
  user?: { type?: string | null } | null;
}

export function findOwnedComment(
  comments: CommentSummary[]
): CommentSummary | undefined {
  return comments.find(
    (comment) =>
      comment.user?.type === "Bot" && comment.body?.includes(COMMENT_MARKER)
  );
}

export function buildCommentBody(result: InspectionResult): string {
  return truncateUtf8(
    `${COMMENT_MARKER}\n${renderMarkdown(result)}`,
    LIMITS.commentBytes
  );
}
