const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const SECRET_PATTERNS = [
  /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
  /\b(github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
  /\b((?:password|passwd|token|secret|authorization)\s*[=:]\s*)[^\s,;]+/gi,
  /\/\/([^:/\s]+):([^@\s]+)@/g
] as const;

export function sanitizeText(value: string): string {
  let sanitized = value.replace(ANSI_PATTERN, "").replace(CONTROL_PATTERN, "");
  sanitized = sanitized
    .replace(SECRET_PATTERNS[0], "[REDACTED]")
    .replace(SECRET_PATTERNS[1], "[REDACTED]")
    .replace(SECRET_PATTERNS[2], "$1[REDACTED]")
    .replace(SECRET_PATTERNS[3], "$1[REDACTED]")
    .replace(SECRET_PATTERNS[4], "//[REDACTED]@");
  return sanitized;
}

export function escapeMarkdown(value: string): string {
  return sanitizeText(value).replace(/([\\`*_{}[\]()<>#+.!|~-])/g, "\\$1");
}

export function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  const suffix = "\n… output truncated …";
  const allowance = Math.max(0, maxBytes - Buffer.byteLength(suffix));
  let end = Math.min(value.length, allowance);
  while (Buffer.byteLength(value.slice(0, end)) > allowance) end -= 1;
  return value.slice(0, end) + suffix;
}

export function toolEnvironment(
  options: { allowActionsCache?: boolean } = {}
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (
      /(TOKEN|SECRET|PASSWORD|PASSWD|AUTHORIZATION|PRIVATE_KEY|ACCESS_KEY)/i.test(
        name
      )
    ) {
      if (
        options.allowActionsCache === true &&
        (name === "ACTIONS_RUNTIME_TOKEN" || name === "ACTIONS_CACHE_URL")
      ) {
        environment[name] = value;
      }
      continue;
    }
    environment[name] = value;
  }
  return environment;
}
