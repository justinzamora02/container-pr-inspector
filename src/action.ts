import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as artifact from "@actions/artifact";
import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  exitCodeFor,
  failureResult,
  inspect
} from "./application.js";
import { loadConfig } from "./core/config.js";
import {
  assertHead,
  ensureCommit,
  findRepositoryRoot
} from "./core/git.js";
import {
  inspectionOptionsForPullRequest,
  type PullRequestEvent
} from "./core/github-event.js";
import { renderJson, renderMarkdown } from "./core/render.js";
import { buildCommentBody, findOwnedComment } from "./core/reporting.js";
import type {
  InspectionOptions,
  InspectionResult
} from "./core/types.js";
import { installScanners } from "./scanner-installer.js";

function pullRequest(): PullRequestEvent {
  if (
    github.context.eventName !== "pull_request" ||
    github.context.payload.pull_request === undefined
  ) {
    throw new Error(
      "Container PR Inspector Action supports pull_request events only"
    );
  }
  return github.context.payload.pull_request as PullRequestEvent;
}

function reportingWarning(result: InspectionResult, message: string): void {
  result.warnings.push(message);
  if (result.conclusion === "passed") result.conclusion = "passed-with-warnings";
}

async function writeResult(
  result: InspectionResult,
  pathname: string
): Promise<void> {
  await mkdir(path.dirname(pathname), { recursive: true });
  await writeFile(pathname, renderJson(result), {
    encoding: "utf8",
    mode: 0o600
  });
}

async function updateComment(
  result: InspectionResult,
  token: string,
  request: PullRequestEvent
): Promise<void> {
  const client = github.getOctokit(token);
  const [owner = "", repo = ""] = request.base.repo.full_name.split("/");
  const comments = await client.paginate(client.rest.issues.listComments, {
    owner,
    repo,
    issue_number: request.number,
    per_page: 100
  });
  const existing = findOwnedComment(comments);
  const body = buildCommentBody(result);
  if (existing) {
    await client.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body
    });
  } else {
    await client.rest.issues.createComment({
      owner,
      repo,
      issue_number: request.number,
      body
    });
  }
}

async function report(
  result: InspectionResult,
  request: PullRequestEvent,
  fork: boolean
): Promise<string> {
  const resultPath = path.join(
    process.env.RUNNER_TEMP ?? os.tmpdir(),
    "container-pr-inspector",
    `pr-${request.number}-result.json`
  );
  const comment = core.getBooleanInput("comment");
  const upload = core.getBooleanInput("upload-artifact");
  const token = core.getInput("github-token");

  if (!fork && comment) {
    try {
      await updateComment(result, token, request);
    } catch (error) {
      reportingWarning(
        result,
        `PR comment unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  try {
    await core.summary.addRaw(renderMarkdown(result)).write();
  } catch (error) {
    reportingWarning(
      result,
      `job summary unavailable: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  await writeResult(result, resultPath);

  if (upload) {
    try {
      const name =
        core.getInput("artifact-name") ||
        `container-pr-inspector-pr-${request.number}`;
      const client = new artifact.DefaultArtifactClient();
      await client.uploadArtifact(name, [resultPath], path.dirname(resultPath), {
        retentionDays: 7
      });
    } catch (error) {
      result.conclusion = "reporting-failed";
      result.warnings.push(
        `artifact upload failed: ${error instanceof Error ? error.message : String(error)}`
      );
      await writeResult(result, resultPath);
    }
  }
  return resultPath;
}

export async function runAction(): Promise<void> {
  let options: InspectionOptions | undefined;
  let request: PullRequestEvent | undefined;
  let fork = false;
  try {
    request = pullRequest();
    const actionMode = inspectionOptionsForPullRequest(
      request,
      core.getInput("config-path")
    );
    fork = actionMode.fork;
    options = {
      ...actionMode.options,
      inspectorVersion: process.env.GITHUB_ACTION_REF ?? "development"
    };

    const repositoryRoot = await findRepositoryRoot();
    await assertHead(repositoryRoot, request.head.sha);
    if (!fork) await ensureCommit(repositoryRoot, request.base.sha);

    const loaded = await loadConfig(options.configPath, repositoryRoot);
    await installScanners({
      trivy: loaded.config.scanners.trivy,
      syft: !fork && loaded.config.scanners.syft
    });

    const result = await inspect(options);
    const resultPath = await report(result, request, fork);
    const firstDigest = result.targets.find((target) => target.base?.image?.digest)
      ?.base?.image?.digest;
    const regressionCount = result.targets.reduce(
      (sum, target) =>
        sum +
        target.findings.filter((finding) => finding.status === "new").length,
      0
    );

    core.setOutput("conclusion", result.conclusion);
    core.setOutput("result-path", resultPath);
    core.setOutput("base-sha", request.base.sha);
    core.setOutput("head-sha", request.head.sha);
    core.setOutput("base-digest", firstDigest ?? "");
    core.setOutput("regression-count", regressionCount);

    if (exitCodeFor(result) !== 0) {
      core.setFailed(`Container PR Inspector: ${result.conclusion}`);
    }
  } catch (error) {
    const result = options ? failureResult(options, error) : undefined;
    if (result && request) {
      try {
        const resultPath = await report(result, request, fork);
        core.setOutput("result-path", resultPath);
      } catch (reportError) {
        core.warning(
          `Could not write failure report: ${
            reportError instanceof Error ? reportError.message : String(reportError)
          }`
        );
      }
      core.setOutput("conclusion", result.conclusion);
      core.setOutput("base-sha", request.base.sha);
      core.setOutput("head-sha", request.head.sha);
    }
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

void runAction();
