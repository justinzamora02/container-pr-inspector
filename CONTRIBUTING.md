# Contributing

## Project structure

The CLI in `src/cli.ts` and GitHub Action in `src/action.ts` are thin entry
points into the shared application service in `src/application.ts`. Keep
inspection, policy, normalization, and reporting logic in `src/core` rather
than creating separate pipelines for the CLI and Action.

This is a single-package repository. Do not add workspace configuration unless
a second independently versioned package is introduced.

## Development

Node.js 24 is the minimum supported runtime, Node.js 26 is the development
runtime, and pnpm 10.13.1 with `pnpm-lock.yaml` is canonical.

Install the locked dependencies and run the complete validation suite:

```sh
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` runs linting, type checking, tests, and the Action bundle build.

Docker integration tests require Linux with Docker and BuildKit and are opt-in:

```sh
CPI_INTEGRATION=1 pnpm vitest run docker.integration.test.ts
```

Add or update tests for behavior changes.

## Generated files

`dist/` is generated and ignored on source branches. Do not edit generated
output by hand or commit it to a source branch. Regenerate it with:

```sh
pnpm bundle
```

Release automation adds only `dist/index.js` and `dist/package.json` to release
tags so published GitHub Action references remain executable.

## Releasing

Create and publish a GitHub Release from a `master` commit with a canonical
SemVer tag such as `v1.2.3`.

Publishing the release:

1. Synchronizes `package.json` to the tag.
2. Runs the full verification suite.
3. Adds the version metadata and generated Action bundle to the release tag.
4. Advances the floating major Action tag, such as `v1`, for a stable release.

The runtime version is always read from `package.json`.

Prereleases must use a prerelease tag such as `v1.2.3-rc.1` and be marked as a
GitHub prerelease. They do not move the floating major Action tag.
