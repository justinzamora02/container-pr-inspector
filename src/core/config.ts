import { realpath, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { ConfigurationError } from "./errors.js";
import type {
  InspectorConfig,
  LoadedConfig,
  Severity,
  TargetConfig
} from "./types.js";

const literalSchema = z
  .union([z.string(), z.number(), z.boolean()])
  .transform((value) => String(value));

const targetSchema = z
  .object({
    name: z.string().trim().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    dockerfile: z.string().trim().min(1),
    context: z.string().trim().min(1),
    baseImage: z.string().trim().min(1).regex(/^\S+$/, "must not contain whitespace"),
    build: z
      .object({
        target: z.string().trim().min(1).optional(),
        args: z
          .record(
            z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "invalid build arg name"),
            literalSchema
          )
          .default({})
      })
      .strict()
      .default({ args: {} })
  })
  .strict();

const severityLimits = z
  .object({
    critical: z.number().int().nonnegative().optional(),
    high: z.number().int().nonnegative().optional(),
    medium: z.number().int().nonnegative().optional(),
    low: z.number().int().nonnegative().optional(),
    unknown: z.number().int().nonnegative().optional()
  })
  .strict();

const configSchema = z
  .object({
    version: z.literal(1),
    targets: z.array(targetSchema).min(1),
    scanners: z
      .object({
        trivy: z.boolean().default(true),
        syft: z.boolean().default(true)
      })
      .strict()
      .default({ trivy: true, syft: true }),
    gates: z
      .object({
        imageSize: z
          .object({
            maxIncreaseBytes: z.number().int().nonnegative().optional(),
            maxIncreasePercent: z.number().nonnegative().optional()
          })
          .strict()
          .optional(),
        vulnerabilities: z
          .object({
            maxNew: severityLimits
          })
          .strict()
          .optional(),
        disallowRoot: z.boolean().optional(),
        requireHealthcheck: z.boolean().optional()
      })
      .strict()
      .default({})
  })
  .strict();

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "configuration";
      return `${location}: ${issue.message}`;
    })
    .join("; ");
}

function validateTemplate(target: TargetConfig): void {
  const variables = [...target.baseImage.matchAll(/\$\{([^}]+)\}/g)].map(
    (match) => match[1]
  );
  const supported = new Set(["owner", "repo", "sha"]);
  const unsupported = variables.filter(
    (variable): variable is string =>
      typeof variable === "string" && !supported.has(variable)
  );
  if (unsupported.length > 0) {
    throw new ConfigurationError(
      `target ${target.name} uses unsupported template variables: ${unsupported.join(", ")}`
    );
  }
  if (!/:[^/]*\$\{sha\}[^/]*$/.test(target.baseImage)) {
    throw new ConfigurationError(
      `target ${target.name} baseImage must contain \${sha} in its tag`
    );
  }
}

async function validatePath(
  repositoryRoot: string,
  configDirectory: string,
  configuredPath: string,
  expected: "file" | "directory",
  label: string
): Promise<void> {
  const lexicalPath = path.resolve(configDirectory, configuredPath);
  if (!isWithin(repositoryRoot, lexicalPath)) {
    throw new ConfigurationError(`${label} escapes the repository`);
  }

  let resolved: string;
  try {
    resolved = await realpath(lexicalPath);
  } catch {
    throw new ConfigurationError(`${label} does not exist: ${configuredPath}`);
  }
  if (!isWithin(repositoryRoot, resolved)) {
    throw new ConfigurationError(`${label} resolves outside the repository`);
  }
  const metadata = await stat(resolved);
  if (expected === "file" ? !metadata.isFile() : !metadata.isDirectory()) {
    throw new ConfigurationError(`${label} is not a ${expected}`);
  }
}

export async function loadConfig(
  configPath: string,
  repositoryRoot: string
): Promise<LoadedConfig> {
  const root = await realpath(repositoryRoot);
  const lexicalConfigPath = path.resolve(root, configPath);
  if (!isWithin(root, lexicalConfigPath)) {
    throw new ConfigurationError("configuration path escapes the repository");
  }

  let absoluteConfigPath: string;
  let source: string;
  try {
    absoluteConfigPath = await realpath(lexicalConfigPath);
    if (!isWithin(root, absoluteConfigPath)) {
      throw new ConfigurationError(
        "configuration path resolves outside the repository"
      );
    }
    source = await readFile(absoluteConfigPath, "utf8");
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError(`cannot read configuration: ${configPath}`);
  }

  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    throw new ConfigurationError(
      `invalid YAML: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigurationError(formatZodError(parsed.error));
  }

  const names = new Set<string>();
  for (const rawTarget of parsed.data.targets) {
    const target = rawTarget as TargetConfig;
    if (names.has(target.name)) {
      throw new ConfigurationError(`duplicate target name: ${target.name}`);
    }
    names.add(target.name);
    validateTemplate(target);
  }

  const configDirectory = path.dirname(absoluteConfigPath);
  await Promise.all(
    parsed.data.targets.flatMap((target) => [
      validatePath(
        root,
        configDirectory,
        target.dockerfile,
        "file",
        `target ${target.name} dockerfile`
      ),
      validatePath(
        root,
        configDirectory,
        target.context,
        "directory",
        `target ${target.name} context`
      )
    ])
  );

  return {
    config: parsed.data as InspectorConfig,
    configPath: absoluteConfigPath,
    repositoryRoot: root
  };
}

export function configuredSeverities(
  config: InspectorConfig
): Array<[Severity, number]> {
  return Object.entries(config.gates.vulnerabilities?.maxNew ?? {}) as Array<
    [Severity, number]
  >;
}

export function resolveTargetPaths(
  loaded: LoadedConfig,
  target: TargetConfig,
  worktreeRoot = loaded.repositoryRoot
): { dockerfile: string; context: string } {
  const relativeConfigDirectory = path.relative(
    loaded.repositoryRoot,
    path.dirname(loaded.configPath)
  );
  const configDirectory = path.join(worktreeRoot, relativeConfigDirectory);
  return {
    dockerfile: path.resolve(configDirectory, target.dockerfile),
    context: path.resolve(configDirectory, target.context)
  };
}

export async function validateTargetPaths(
  loaded: LoadedConfig,
  target: TargetConfig,
  worktreeRoot = loaded.repositoryRoot
): Promise<void> {
  const root = await realpath(worktreeRoot);
  const relativeConfigDirectory = path.relative(
    loaded.repositoryRoot,
    path.dirname(loaded.configPath)
  );
  const configDirectory = path.join(root, relativeConfigDirectory);
  await Promise.all([
    validatePath(
      root,
      configDirectory,
      target.dockerfile,
      "file",
      `target ${target.name} dockerfile`
    ),
    validatePath(
      root,
      configDirectory,
      target.context,
      "directory",
      `target ${target.name} context`
    )
  ]);
}
