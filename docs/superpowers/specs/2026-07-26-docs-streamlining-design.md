# Documentation Streamlining Design

## Goal

Make the repository documentation faster for GitHub Action users to adopt while
preserving the security model, configuration contract, CLI guidance, and
maintainer procedures.

Success means a new user can find a minimal working configuration and workflow
near the top of the README, while contributor-only material no longer
interrupts that path.

## Approaches Considered

### Recommended: focused README plus contributor guide

Keep installation, configuration, runtime behavior, Action reference, and
result format in `README.md`. Move local development, validation, generated
file, and release instructions to `CONTRIBUTING.md`.

This adds one clearly scoped document but gives product users and maintainers
separate reading paths.

### Single reorganized README

Reorder the current README without adding another file. This minimizes the file
count, but contributor and release details still compete with product
documentation and make future growth harder to manage.

### Multi-page documentation directory

Split configuration, security, CLI, and maintenance into separate pages. This
provides the most room for expansion, but creates unnecessary navigation and
maintenance overhead for the repository's current size.

## README Design

The README will follow this order:

1. A short description of what the Action reports and enforces.
2. A quick start containing:
   - the smallest valid `.container-pr-inspector.yml`;
   - a copy-paste `pull_request` workflow;
   - conditional notes for comment and private-registry permissions.
3. A same-repository versus fork comparison table that makes the isolation
   boundary explicit.
4. A complete configuration example and concise explanation of defaults,
   templates, build arguments, and report-only behavior.
5. An Action reference for inputs, outputs, and reporting behavior.
6. A short result-format section linking directly to the JSON schema.
7. A local CLI section containing usage, requirements, template resolution, and
   exit codes.
8. A contributor link and license.

The quick-start workflow will use the repository's real Action slug and current
major versions consistent with its own CI examples.

## Contributor Guide Design

`CONTRIBUTING.md` will contain:

- the supported Node.js and pnpm versions;
- install and `pnpm verify` commands;
- the optional Linux Docker/BuildKit integration-test command;
- the generated `dist/` policy;
- the existing release procedure and prerelease behavior.

It will not duplicate end-user configuration or Action usage.

## Drift Reduction

Exact Trivy and Syft versions will not be copied into prose. The README will
state that the Action downloads pinned, checksum-verified scanner releases and
link to `src/scanner-manifest.ts` as the source of truth.

The result schema link will point to `schema/result-v1.schema.json` in the
repository rather than imply that the currently unpublished npm package is
available to consumers.

Action input and output names will remain aligned with `action.yml`. Descriptions
will be concise and will identify conditional permissions instead of presenting
all permissions as universally required.

## Validation

Documentation-only validation will include:

- checking all referenced repository paths;
- comparing documented Action inputs and outputs with `action.yml`;
- comparing CLI examples with `src/cli-arguments.ts`;
- reviewing the Markdown diff for duplicated or missing guidance;
- running `pnpm verify`, as required by the repository guide.

