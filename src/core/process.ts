import { spawn } from "node:child_process";
import { CommandError } from "./errors.js";
import { LIMITS } from "./constants.js";
import { sanitizeText, truncateUtf8 } from "./security.js";

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
  input?: string;
  allowFailure?: boolean;
}

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function displayCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((part) => (/^[A-Za-z0-9_./:@=-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
}

export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  const maxBytes = options.maxOutputBytes ?? LIMITS.commandOutputBytes;
  const rendered = displayCommand(command, args);

  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const append = (current: string, chunk: Buffer): string => {
      if (Buffer.byteLength(current) >= maxBytes) return current;
      return truncateUtf8(current + chunk.toString("utf8"), maxBytes);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, options.timeoutMs ?? LIMITS.scanTimeoutMs);
    timeout.unref();

    child.once("error", (error) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      const commandError = new CommandError({
        command: rendered,
        exitCode: null,
        stdout: sanitizeText(stdout),
        stderr: sanitizeText(`${stderr}\n${error.message}`.trim()),
        timedOut
      });
      if (options.allowFailure) {
        resolve({
          command,
          args,
          exitCode: null,
          stdout: commandError.stdout,
          stderr: commandError.stderr,
          timedOut
        });
      } else {
        reject(commandError);
      }
    });

    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      const result: CommandResult = {
        command,
        args,
        exitCode,
        stdout: sanitizeText(stdout),
        stderr: sanitizeText(stderr),
        timedOut
      };
      if ((exitCode !== 0 || timedOut) && !options.allowFailure) {
        reject(
          new CommandError({
            command: rendered,
            exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            timedOut
          })
        );
      } else {
        resolve(result);
      }
    });

    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

export async function executableVersion(
  executable: string,
  args = ["--version"]
): Promise<string | undefined> {
  const result = await runCommand(executable, args, {
    timeoutMs: 10_000,
    maxOutputBytes: 64 * 1024,
    allowFailure: true
  });
  if (result.exitCode !== 0) return undefined;
  return (result.stdout || result.stderr).trim().split(/\r?\n/, 1)[0];
}
