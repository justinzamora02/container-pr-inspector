#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { exitCodeFor, inspect } from "./application.js";
import {
  CliArgumentError,
  parseCliArguments,
  type OutputFormat
} from "./cli-arguments.js";
import { renderJson, renderTerminal } from "./core/render.js";
import { sanitizeText } from "./core/security.js";
import type { InspectionResult } from "./core/types.js";

const { version: VERSION } = createRequire(import.meta.url)(
  "../package.json"
) as {
  version: string;
};

async function emit(
  result: InspectionResult,
  format: OutputFormat,
  output?: string
): Promise<void> {
  const rendered = format === "json" ? renderJson(result) : renderTerminal(result);
  if (output) {
    const absolute = path.resolve(output);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, rendered, { encoding: "utf8", mode: 0o600 });
  } else {
    process.stdout.write(rendered);
  }
  process.exitCode = exitCodeFor(result);
}

async function main(): Promise<void> {
  try {
    const arguments_ = parseCliArguments(process.argv.slice(2));
    if (arguments_.command === "help") {
      process.stdout.write(arguments_.text);
      process.exitCode = arguments_.exitCode;
      return;
    }
    if (arguments_.command === "version") {
      process.stdout.write(`${VERSION}\n`);
      process.exitCode = 0;
      return;
    }
    if (arguments_.command === "compare") {
      const result = await inspect({
        mode: "compare",
        baseSha: arguments_.baseSha,
        headSha: arguments_.headSha,
        configPath: arguments_.config,
        inspectorVersion: VERSION,
        ...(arguments_.repository
          ? { repository: arguments_.repository }
          : {})
      });
      await emit(result, arguments_.format, arguments_.output);
      return;
    }
    const result = await inspect({
      mode: "audit",
      ref: arguments_.ref,
      configPath: arguments_.config,
      inspectorVersion: VERSION,
      ...(arguments_.repository ? { repository: arguments_.repository } : {})
    });
    await emit(result, arguments_.format, arguments_.output);
  } catch (error) {
    if (error instanceof CliArgumentError) {
      process.stderr.write(`error: ${sanitizeText(error.message)}\n\n`);
      process.stdout.write(error.help);
    } else {
      process.stderr.write(
        `${sanitizeText(error instanceof Error ? error.message : String(error))}\n`
      );
    }
    process.exitCode = 2;
  }
}

try {
  await main();
} catch (error) {
    process.stderr.write(
      `${sanitizeText(error instanceof Error ? error.message : String(error))}\n`
    );
    process.exitCode = 2;
}
