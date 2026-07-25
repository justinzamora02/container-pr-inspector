import { ConfigurationError } from "./errors.js";

export interface TemplateContext {
  owner: string;
  repo: string;
  sha: string;
}

export function expandImageTemplate(
  template: string,
  context: TemplateContext
): string {
  const values: Record<string, string> = {
    owner: context.owner,
    repo: context.repo,
    sha: context.sha
  };
  return template.replace(/\$\{([^}]+)\}/g, (_match, variable: string) => {
    const value = values[variable];
    if (value === undefined) {
      throw new ConfigurationError(`unsupported template variable: ${variable}`);
    }
    return value;
  });
}

export function parseRepository(value: string): {
  owner: string;
  repo: string;
  fullName: string;
} {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(value.trim());
  if (!match?.[1] || !match[2]) {
    throw new ConfigurationError(
      `repository must use owner/repo syntax, received: ${value}`
    );
  }
  return { owner: match[1], repo: match[2], fullName: `${match[1]}/${match[2]}` };
}
