export class InspectorError extends Error {
  readonly code: string;
  readonly operational: boolean;

  constructor(code: string, message: string, operational = true) {
    super(message);
    this.name = "InspectorError";
    this.code = code;
    this.operational = operational;
  }
}

export class ConfigurationError extends InspectorError {
  constructor(message: string) {
    super("CONFIG_ERROR", message);
    this.name = "ConfigurationError";
  }
}

export class CommandError extends InspectorError {
  readonly command: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;

  constructor(options: {
    command: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }) {
    const reason = options.timedOut
      ? "timed out"
      : `exited with ${options.exitCode ?? "no status"}`;
    super("COMMAND_FAILED", `${options.command} ${reason}`);
    this.name = "CommandError";
    this.command = options.command;
    this.exitCode = options.exitCode;
    this.stdout = options.stdout;
    this.stderr = options.stderr;
    this.timedOut = options.timedOut;
  }
}
