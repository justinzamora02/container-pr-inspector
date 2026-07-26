# Container PR Inspector

`container-pr-inspector` is one TypeScript tool with two invocation surfaces:
an npm CLI and a bundled GitHub Action. Both call the same inspection pipeline,
policy evaluator, result schema, and renderers.

It compares Docker images for two Git revisions, reports size and metadata
changes, identifies package and vulnerability deltas with Syft and Trivy, and
optionally enforces regression gates. Fork pull requests are handled by a
separate static-only mode that never invokes Docker or executes repository code.

## Requirements

- Node.js 24 or newer for the CLI
- Linux with Docker and BuildKit for image inspection
- Trivy and Syft on `PATH` for local scans; missing tools are reported explicitly
- A local Git repository containing the referenced commits

The GitHub Action downloads pinned Trivy 0.72.0 and Syft 1.44.0 archives,
verifies their committed SHA-256 values, and caches the verified tools.

## CLI

```sh
npm install --global container-pr-inspector

container-pr-inspector compare \
  --base-sha "$BASE_SHA" \
  --head-sha WORKTREE \
  --config .container-pr-inspector.yml \
  --format terminal

container-pr-inspector audit \
  --ref WORKTREE \
  --config .container-pr-inspector.yml \
  --format json \
  --output result.json
```

Repository template values are resolved from `--repository owner/repo`,
`GITHUB_REPOSITORY`, or a recognizable GitHub `origin` URL, in that order.

Exit codes are `0` for pass, warning, report-only, or neutral results; `1` for
policy failure; and `2` for configuration or operational failure.

## Configuration

```yaml
version: 1

targets:
  - name: app
    dockerfile: Dockerfile
    context: .
    baseImage: ghcr.io/${owner}/${repo}:${sha}
    build:
      target: runtime
      args:
        NODE_ENV: production

scanners:
  trivy: true
  syft: true

gates:
  imageSize:
    maxIncreaseBytes: 52428800
    maxIncreasePercent: 10
  vulnerabilities:
    maxNew:
      critical: 0
      high: 0
  disallowRoot: true
  requireHealthcheck: true
```

Only `${owner}`, `${repo}`, and `${sha}` are expanded. Build arguments are
literal configuration values; environment interpolation, BuildKit secrets, and
SSH forwarding are not supported. Empty gates are report-only.

## GitHub Action

The Action supports `pull_request`, not `pull_request_target`. Check out the
exact head SHA and retain history so the frozen event base SHA is available:

```yaml
name: Container inspection

on:
  pull_request:

permissions:
  contents: read
  packages: read
  pull-requests: write

jobs:
  inspect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
      - uses: docker/setup-buildx-action@v3
      # Authenticate the Docker credential store here when the base image is private.
      - uses: OWNER/container-pr-inspector@v1
        with:
          config-path: .container-pr-inspector.yml
```

Same-repository PRs receive a job summary, JSON artifact, and one bot-owned
comment updated through the marker `<!-- container-pr-inspector:v1 -->`. Fork
PRs receive static Dockerfile/Trivy configuration analysis, a neutral result for
image-only gates, a summary, and an artifact. Fork mode never calls Docker,
BuildKit, a registry, Syft, image scanning, repository scripts, or custom Trivy
policies.

## JSON result

Every result uses `schemaVersion: 1` and records exact refs, resolved platform,
image digests, tool and database metadata, normalized findings, gate
evaluations, and a distinct conclusion. The distributable schema is exported as
`container-pr-inspector/schema/result-v1.json`.

## Development

```sh
pnpm install
pnpm verify
```

The `dist/` directory is generated and ignored on source branches. Release
automation adds the Node 24 Action bundle only to release tags so that published
Action references remain directly executable.

## Releasing

Create and publish a GitHub Release from a `master` commit with a canonical
SemVer tag such as `v1.2.3`. Publishing the release synchronizes `package.json`
to the tag, runs the full verification suite, adds the version metadata and
generated Action bundle to the release tag, publishes the npm package, and
advances the floating major Action tag (for example, `v1`) for stable releases.
The runtime version is always read from `package.json`. Prereleases must use a
prerelease tag such as `v1.2.3-rc.1`; they are published under the npm `next`
tag and do not move the floating Action tag.

The npm package must trust the GitHub Actions publisher for this repository and
the workflow filename `release.yml`.

## License

MIT
