import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import * as core from "@actions/core";
import * as toolCache from "@actions/tool-cache";
import { InspectorError } from "./core/errors.js";
import { SCANNER_RELEASES } from "./scanner-manifest.js";

type ScannerName = keyof typeof SCANNER_RELEASES;

async function sha256(pathname: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(pathname);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function runnerArchitecture(): "x64" | "arm64" {
  if (process.arch === "x64" || process.arch === "arm64") return process.arch;
  throw new InspectorError(
    "SCANNER_DOWNLOAD_FAILED",
    `unsupported runner architecture: ${process.arch}`
  );
}

export async function installScanner(name: ScannerName): Promise<string> {
  if (process.platform !== "linux") {
    throw new InspectorError(
      "SCANNER_DOWNLOAD_FAILED",
      `the GitHub Action supports Linux only, received ${process.platform}`
    );
  }
  const release = SCANNER_RELEASES[name];
  const architecture = runnerArchitecture();
  const existing = toolCache.find(name, release.version, architecture);
  if (existing) {
    core.addPath(existing);
    return path.join(existing, release.assets[architecture].executable);
  }

  const asset = release.assets[architecture];
  const archive = await toolCache.downloadTool(asset.url);
  const actual = await sha256(archive);
  if (actual !== asset.sha256) {
    throw new InspectorError(
      "SCANNER_DOWNLOAD_FAILED",
      `${name} ${release.version} checksum mismatch: expected ${asset.sha256}, received ${actual}`
    );
  }
  const extracted = await toolCache.extractTar(archive);
  const cached = await toolCache.cacheDir(
    extracted,
    name,
    release.version,
    architecture
  );
  core.addPath(cached);
  return path.join(cached, asset.executable);
}

export async function installScanners(options: {
  trivy: boolean;
  syft: boolean;
}): Promise<void> {
  const requested: ScannerName[] = [];
  if (options.trivy) requested.push("trivy");
  if (options.syft) requested.push("syft");
  for (const scanner of requested) {
    core.info(`Installing pinned ${scanner} ${SCANNER_RELEASES[scanner].version}`);
    await installScanner(scanner);
  }
}
