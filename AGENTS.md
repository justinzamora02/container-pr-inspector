# Repository Guide

## Product shape

- This repository contains one published package and one product:
  `container-pr-inspector`.
- The CLI (`src/cli.ts`) and GitHub Action (`src/action.ts`) are thin entry
  points into the same application service in `src/application.ts`.
- Keep inspection, policy, normalization, and reporting logic in `src/core`.
  Do not create separate CLI and Action implementations of the pipeline.
- `master` is the primary branch.

## Toolchain

- Node.js 24 is the minimum supported runtime; Node.js 26 is the development
  runtime.
- pnpm 10.13.1 and `pnpm-lock.yaml` are canonical.
- This is intentionally a single-package repository. Do not add workspace
  plumbing unless a second independently versioned package is introduced.
- Bun compatibility is not a release requirement.

## Security invariants

- Fork pull requests are static-analysis only. Fork mode must never invoke
  Docker, BuildKit, a registry, image scanning, Syft, repository scripts, or
  custom Trivy policies.
- Never add a `pull_request_target` workflow.
- Never pass secrets, credentials, SSH forwarding, or environment-derived
  build arguments into image builds.
- Preserve repository path-containment checks, redaction, output limits, and
  process timeouts.

## Generated files

- `dist/` is generated and must not be committed to source branches.
- Do not edit generated output by hand. Regenerate it with `pnpm bundle`.
- Release automation adds `dist/index.js` and `dist/package.json` only to
  release tags so the published GitHub Action remains executable.

## Validation

- Run `pnpm verify` before handing off changes.
- Add or update tests for behavior changes.
- Docker integration tests require a Linux Docker/BuildKit environment:
  `CPI_INTEGRATION=1 pnpm vitest run docker.integration.test.ts`.
