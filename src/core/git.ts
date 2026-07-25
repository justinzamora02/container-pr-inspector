import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConfigurationError, InspectorError } from "./errors.js";
import { runCommand } from "./process.js";
import { WORKTREE } from "./constants.js";

export async function findRepositoryRoot(cwd = process.cwd()): Promise<string> {
  const result = await runCommand(
    "git",
    ["rev-parse", "--show-toplevel"],
    { cwd, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, allowFailure: true }
  );
  if (result.exitCode !== 0) {
    throw new ConfigurationError("current directory is not a Git repository");
  }
  return result.stdout.trim();
}

export async function resolveCommit(
  repositoryRoot: string,
  ref: string
): Promise<string> {
  if (ref === WORKTREE) {
    const result = await runCommand("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024
    });
    return result.stdout.trim();
  }
  const result = await runCommand(
    "git",
    ["rev-parse", "--verify", `${ref}^{commit}`],
    {
      cwd: repositoryRoot,
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
      allowFailure: true
    }
  );
  if (result.exitCode !== 0) {
    throw new ConfigurationError(`Git ref is unavailable locally: ${ref}`);
  }
  return result.stdout.trim();
}

export async function ensureCommit(
  repositoryRoot: string,
  sha: string
): Promise<string> {
  try {
    return await resolveCommit(repositoryRoot, sha);
  } catch {
    await runCommand(
      "git",
      ["fetch", "--no-tags", "--depth=1", "origin", sha],
      {
        cwd: repositoryRoot,
        timeoutMs: 2 * 60 * 1000,
        maxOutputBytes: 2 * 1024 * 1024
      }
    );
    return await resolveCommit(repositoryRoot, sha);
  }
}

export async function assertHead(
  repositoryRoot: string,
  expectedSha: string
): Promise<void> {
  const actual = await resolveCommit(repositoryRoot, "HEAD");
  if (actual !== expectedSha) {
    throw new ConfigurationError(
      `checked-out HEAD ${actual} does not match pull-request head ${expectedSha}`
    );
  }
}

export async function originUrl(
  repositoryRoot: string
): Promise<string | undefined> {
  const result = await runCommand("git", ["remote", "get-url", "origin"], {
    cwd: repositoryRoot,
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
    allowFailure: true
  });
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

export function repositoryFromRemote(remote: string): string | undefined {
  const match =
    /github\.com[/:]([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/.exec(remote.trim());
  if (!match?.[1] || !match[2]) return undefined;
  return `${match[1]}/${match[2]}`;
}

export async function resolveRepositoryName(
  repositoryRoot: string,
  explicit?: string
): Promise<string | undefined> {
  if (explicit?.trim()) return explicit.trim();
  if (process.env.GITHUB_REPOSITORY?.trim()) {
    return process.env.GITHUB_REPOSITORY.trim();
  }
  const remote = await originUrl(repositoryRoot);
  return remote ? repositoryFromRemote(remote) : undefined;
}

export interface MaterializedRef {
  sha: string;
  root: string;
  cleanup: () => Promise<void>;
}

export async function materializeRef(
  repositoryRoot: string,
  ref: string
): Promise<MaterializedRef> {
  const sha = await resolveCommit(repositoryRoot, ref);
  if (ref === WORKTREE) {
    return { sha, root: repositoryRoot, cleanup: () => Promise.resolve() };
  }

  const parent = await mkdtemp(path.join(os.tmpdir(), "container-pr-inspector-"));
  const checkout = path.join(parent, "checkout");
  try {
    await runCommand("git", ["worktree", "add", "--detach", checkout, sha], {
      cwd: repositoryRoot,
      timeoutMs: 2 * 60 * 1000
    });
  } catch (error) {
    await rm(parent, { recursive: true, force: true });
    throw new InspectorError(
      "GIT_WORKTREE_FAILED",
      error instanceof Error ? error.message : String(error)
    );
  }

  return {
    sha,
    root: checkout,
    cleanup: async () => {
      await runCommand("git", ["worktree", "remove", "--force", checkout], {
        cwd: repositoryRoot,
        timeoutMs: 60_000,
        allowFailure: true
      });
      await rm(parent, { recursive: true, force: true });
    }
  };
}
