import { parseArgs, type ParseArgsConfig } from "node:util";

export type OutputFormat = "terminal" | "json";

interface SharedArguments {
  config: string;
  repository?: string;
  format: OutputFormat;
  output?: string;
}

export type CliArguments =
  | ({ command: "compare"; baseSha: string; headSha: string } & SharedArguments)
  | ({ command: "audit"; ref: string } & SharedArguments)
  | { command: "help"; text: string; exitCode: 0 | 2 }
  | { command: "version" };

export class CliArgumentError extends Error {
  constructor(
    message: string,
    readonly help: string
  ) {
    super(message);
    this.name = "CliArgumentError";
  }
}

export const ROOT_HELP = `Usage: container-pr-inspector [options] [command]

Compare Docker images across revisions and enforce regression policy.

Options:
  -V, --version      output the version number
  -h, --help         display help for command

Commands:
  compare [options]
  audit [options]
  help [command]     display help for command
`;

export const COMPARE_HELP = `Usage: container-pr-inspector compare [options]

Options:
  --base-sha <sha>              base Git commit
  --head-sha <sha-or-WORKTREE>  head Git commit or WORKTREE
  --config <path>               configuration path (default:
                                ".container-pr-inspector.yml")
  --repository <owner/repo>     repository template context
  --format <format>             terminal or json (default: "terminal")
  --output <path>               write output to a file
  -h, --help                    display help for command
`;

export const AUDIT_HELP = `Usage: container-pr-inspector audit [options]

Options:
  --ref <sha-or-WORKTREE>    Git commit or WORKTREE
  --config <path>            configuration path (default:
                             ".container-pr-inspector.yml")
  --repository <owner/repo>  repository template context
  --format <format>          terminal or json (default: "terminal")
  --output <path>            write output to a file
  -h, --help                 display help for command
`;

const sharedOptions = {
  config: {
    type: "string",
    default: ".container-pr-inspector.yml"
  },
  repository: { type: "string" },
  format: {
    type: "string",
    default: "terminal"
  },
  output: { type: "string" },
  help: {
    type: "boolean",
    short: "h"
  }
} as const;

function parseCommand(
  args: string[],
  options: ParseArgsConfig["options"],
  help: string
): ReturnType<typeof parseArgs> {
  try {
    return parseArgs({
      args,
      options,
      strict: true,
      allowPositionals: false
    });
  } catch (error) {
    throw new CliArgumentError(
      error instanceof Error ? error.message : String(error),
      help
    );
  }
}

function formatValue(value: string, help: string): OutputFormat {
  if (value === "terminal" || value === "json") return value;
  throw new CliArgumentError(
    `option '--format <format>' argument '${value}' is invalid. format must be terminal or json`,
    help
  );
}

function sharedValues(
  values: ReturnType<typeof parseArgs>["values"],
  help: string
): SharedArguments {
  const config = values.config;
  const format = values.format;
  if (typeof config !== "string" || typeof format !== "string") {
    throw new CliArgumentError("invalid command options", help);
  }
  return {
    config,
    format: formatValue(format, help),
    ...(typeof values.repository === "string"
      ? { repository: values.repository }
      : {}),
    ...(typeof values.output === "string" ? { output: values.output } : {})
  };
}

function required(
  values: ReturnType<typeof parseArgs>["values"],
  name: string,
  display: string,
  help: string
): string {
  const value = values[name];
  if (typeof value !== "string") {
    throw new CliArgumentError(
      `required option '${display}' not specified`,
      help
    );
  }
  return value;
}

function parseCompare(args: string[]): CliArguments {
  const parsed = parseCommand(
    args,
    {
      ...sharedOptions,
      "base-sha": { type: "string" },
      "head-sha": { type: "string" }
    },
    COMPARE_HELP
  );
  if (parsed.values.help === true) {
    return { command: "help", text: COMPARE_HELP, exitCode: 0 };
  }
  return {
    command: "compare",
    baseSha: required(
      parsed.values,
      "base-sha",
      "--base-sha <sha>",
      COMPARE_HELP
    ),
    headSha: required(
      parsed.values,
      "head-sha",
      "--head-sha <sha-or-WORKTREE>",
      COMPARE_HELP
    ),
    ...sharedValues(parsed.values, COMPARE_HELP)
  };
}

function parseAudit(args: string[]): CliArguments {
  const parsed = parseCommand(
    args,
    {
      ...sharedOptions,
      ref: { type: "string" }
    },
    AUDIT_HELP
  );
  if (parsed.values.help === true) {
    return { command: "help", text: AUDIT_HELP, exitCode: 0 };
  }
  return {
    command: "audit",
    ref: required(
      parsed.values,
      "ref",
      "--ref <sha-or-WORKTREE>",
      AUDIT_HELP
    ),
    ...sharedValues(parsed.values, AUDIT_HELP)
  };
}

export function parseCliArguments(args: string[]): CliArguments {
  const [command, ...rest] = args;
  if (command === undefined) {
    return { command: "help", text: ROOT_HELP, exitCode: 2 };
  }
  if (command === "--help" || command === "-h") {
    return { command: "help", text: ROOT_HELP, exitCode: 0 };
  }
  if (command === "--version" || command === "-V") {
    return { command: "version" };
  }
  if (command === "help") {
    const [topic, extra] = rest;
    if (extra !== undefined) {
      throw new CliArgumentError(`unknown help topic '${extra}'`, ROOT_HELP);
    }
    if (topic === undefined) {
      return { command: "help", text: ROOT_HELP, exitCode: 0 };
    }
    if (topic === "compare") {
      return { command: "help", text: COMPARE_HELP, exitCode: 0 };
    }
    if (topic === "audit") {
      return { command: "help", text: AUDIT_HELP, exitCode: 0 };
    }
    throw new CliArgumentError(`unknown help topic '${topic}'`, ROOT_HELP);
  }
  if (command === "compare") return parseCompare(rest);
  if (command === "audit") return parseAudit(rest);
  throw new CliArgumentError(`unknown command '${command}'`, ROOT_HELP);
}
