import { access } from "node:fs/promises";
import { LIMITS } from "./constants.js";
import { CommandError, InspectorError } from "./errors.js";
import { runCommand } from "./process.js";
import { sanitizeText, toolEnvironment } from "./security.js";
import type {
  ImageMetadata,
  LoadedConfig,
  Platform,
  TargetConfig
} from "./types.js";
import { resolveTargetPaths, validateTargetPaths } from "./config.js";

interface DockerInspect {
  Id?: string;
  RepoDigests?: string[];
  Size?: number;
  Architecture?: string;
  Os?: string;
  Variant?: string;
  RootFS?: { Layers?: string[] };
  Config?: {
    User?: string;
    Labels?: Record<string, string>;
    Healthcheck?: {
      Test?: string[];
      Interval?: number;
      Timeout?: number;
      Retries?: number;
      StartPeriod?: number;
    };
  };
}

function normalizeArchitecture(value: string): string {
  if (value === "x86_64" || value === "x64") return "amd64";
  if (value === "aarch64") return "arm64";
  return value;
}

export function platformString(platform: Platform): string {
  return [platform.os, platform.architecture, platform.variant]
    .filter(Boolean)
    .join("/");
}

export async function resolveDockerPlatform(): Promise<Platform> {
  const result = await runCommand(
    "docker",
    ["info", "--format", "{{.OSType}}/{{.Architecture}}"],
    {
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
      env: toolEnvironment()
    }
  );
  const [os, rawArchitecture] = result.stdout.trim().split("/");
  if (!os || !rawArchitecture) {
    throw new InspectorError(
      "DOCKER_PLATFORM_UNAVAILABLE",
      `unexpected docker platform: ${result.stdout.trim()}`
    );
  }
  return { os, architecture: normalizeArchitecture(rawArchitecture) };
}

export async function inspectImage(
  reference: string,
  expectedPlatform?: Platform
): Promise<ImageMetadata> {
  const result = await runCommand(
    "docker",
    ["image", "inspect", "--format", "{{json .}}", reference],
    {
      timeoutMs: 30_000,
      env: toolEnvironment()
    }
  );
  let raw: DockerInspect;
  try {
    raw = JSON.parse(result.stdout) as DockerInspect;
  } catch {
    throw new InspectorError(
      "DOCKER_INSPECT_INVALID",
      `docker returned invalid metadata for ${reference}`
    );
  }
  if (!raw.Id || typeof raw.Size !== "number" || !raw.Os || !raw.Architecture) {
    throw new InspectorError(
      "DOCKER_INSPECT_INCOMPLETE",
      `docker returned incomplete metadata for ${reference}`
    );
  }

  const platform: Platform = {
    os: raw.Os,
    architecture: normalizeArchitecture(raw.Architecture),
    ...(raw.Variant ? { variant: raw.Variant } : {})
  };
  if (
    expectedPlatform &&
    platformString(platform) !== platformString(expectedPlatform)
  ) {
    throw new InspectorError(
      "PLATFORM_MISMATCH",
      `${reference} resolved to ${platformString(platform)}, expected ${platformString(expectedPlatform)}`
    );
  }

  const health = raw.Config?.Healthcheck;
  const repository = reference
    .replace(/@sha256:[a-f0-9]+$/i, "")
    .replace(/:([^/]+)$/, "");
  const repoDigest =
    raw.RepoDigests?.find((digest) => digest.startsWith(`${repository}@`)) ??
    raw.RepoDigests?.[0];
  return {
    reference,
    digest: repoDigest ?? raw.Id,
    imageId: raw.Id,
    ...(raw.Config?.Labels?.["org.opencontainers.image.revision"]
      ? { revision: raw.Config.Labels["org.opencontainers.image.revision"] }
      : {}),
    platform,
    sizeBytes: raw.Size,
    layers: raw.RootFS?.Layers ?? [],
    user: raw.Config?.User ?? "",
    ...(health?.Test
      ? {
          healthcheck: {
            test: health.Test,
            ...(health.Interval !== undefined ? { interval: health.Interval } : {}),
            ...(health.Timeout !== undefined ? { timeout: health.Timeout } : {}),
            ...(health.Retries !== undefined ? { retries: health.Retries } : {}),
            ...(health.StartPeriod !== undefined
              ? { startPeriod: health.StartPeriod }
              : {})
          }
        }
      : {})
  };
}

export type RemoteVerification =
  | { accepted: true; image: ImageMetadata }
  | {
      accepted: false;
      verification:
        | "not-found"
        | "pull-failed"
        | "missing-digest"
        | "missing-revision"
        | "revision-mismatch";
      message: string;
    };

export function verifyBaseImage(
  image: ImageMetadata,
  expectedSha: string
): RemoteVerification {
  if (!image.digest) {
    return {
      accepted: false,
      verification: "missing-digest",
      message: "remote image has no immutable digest"
    };
  }
  if (!image.revision) {
    return {
      accepted: false,
      verification: "missing-revision",
      message: "remote image has no org.opencontainers.image.revision label"
    };
  }
  if (image.revision !== expectedSha) {
    return {
      accepted: false,
      verification: "revision-mismatch",
      message: `remote image revision ${image.revision} does not match ${expectedSha}`
    };
  }
  return { accepted: true, image };
}

export async function pullAndVerifyBase(
  reference: string,
  expectedSha: string,
  platform: Platform
): Promise<RemoteVerification> {
  try {
    await runCommand(
      "docker",
      ["pull", "--platform", platformString(platform), reference],
      {
        timeoutMs: LIMITS.downloadTimeoutMs,
        env: toolEnvironment()
      }
    );
  } catch (error) {
    const detail =
      error instanceof CommandError
        ? `${error.stderr}\n${error.stdout}`.trim()
        : error instanceof Error
          ? error.message
          : String(error);
    const notFound = /not found|manifest unknown|no such manifest/i.test(detail);
    return {
      accepted: false,
      verification: notFound ? "not-found" : "pull-failed",
      message: sanitizeText(detail || `could not pull ${reference}`)
    };
  }

  let image: ImageMetadata;
  try {
    image = await inspectImage(reference, platform);
  } catch (error) {
    return {
      accepted: false,
      verification: "pull-failed",
      message: sanitizeText(
        error instanceof Error ? error.message : String(error)
      )
    };
  }
  return verifyBaseImage(image, expectedSha);
}

function imageTag(target: string, side: "base" | "head", sha: string): string {
  const safeTarget = target.toLowerCase().replace(/[^a-z0-9_.-]/g, "-");
  return `container-pr-inspector:${safeTarget}-${side}-${sha.slice(0, 12)}`;
}

function cacheScope(target: string, platform: Platform): string {
  return `container-pr-inspector-${target}-${platform.architecture}`.replace(
    /[^A-Za-z0-9_.-]/g,
    "-"
  );
}

export async function buildImage(options: {
  loaded: LoadedConfig;
  target: TargetConfig;
  worktreeRoot: string;
  side: "base" | "head";
  sha: string;
  platform: Platform;
}): Promise<ImageMetadata> {
  await validateTargetPaths(options.loaded, options.target, options.worktreeRoot);
  const paths = resolveTargetPaths(
    options.loaded,
    options.target,
    options.worktreeRoot
  );
  await Promise.all([access(paths.dockerfile), access(paths.context)]);
  const tag = imageTag(options.target.name, options.side, options.sha);
  const args = [
    "buildx",
    "build",
    "--load",
    "--platform",
    platformString(options.platform),
    "--file",
    paths.dockerfile,
    "--tag",
    tag,
    "--label",
    `org.opencontainers.image.revision=${options.sha}`,
    "--provenance=false"
  ];
  if (options.target.build.target) {
    args.push("--target", options.target.build.target);
  }
  for (const [name, value] of Object.entries(options.target.build.args).sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    args.push("--build-arg", `${name}=${value}`);
  }

  const useGhaCache =
    process.env.GITHUB_ACTIONS === "true" &&
    Boolean(process.env.ACTIONS_RUNTIME_TOKEN && process.env.ACTIONS_CACHE_URL);
  if (useGhaCache) {
    const scope = cacheScope(options.target.name, options.platform);
    args.push("--cache-from", `type=gha,scope=${scope}`);
    args.push("--cache-to", `type=gha,scope=${scope},mode=max`);
  }
  args.push(paths.context);

  await runCommand("docker", args, {
    timeoutMs: LIMITS.buildTimeoutMs,
    env: toolEnvironment({ allowActionsCache: useGhaCache })
  });
  return await inspectImage(tag, options.platform);
}

export async function dockerVersion(): Promise<string | undefined> {
  const result = await runCommand("docker", ["version", "--format", "{{.Client.Version}}"], {
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
    env: toolEnvironment(),
    allowFailure: true
  });
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}
