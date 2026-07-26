# Container PR Inspector

`container-pr-inspector` is a GitHub Action that compares container images
across a pull request. It reports image size and metadata changes, package and
vulnerability deltas from Syft and Trivy, and optional policy failures.

Fork pull requests use a static-only inspection path that does not build images,
access registries, or execute repository code.

## Quick start

Add `.container-pr-inspector.yml`:

```yaml
version: 1

targets:
  - name: app
    dockerfile: Dockerfile
    context: .
    baseImage: ghcr.io/${owner}/${repo}:${sha}
```

Then add a pull-request workflow:

```yaml
name: Container inspection

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write # Omit when comments are disabled.
  packages: read      # Only for private GitHub Packages base images.

jobs:
  inspect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
      - uses: docker/setup-buildx-action@v4
      # Authenticate the Docker credential store here for private base images.
      - uses: justinzamora02/container-pr-inspector@v1
```

The exact head SHA and full history are required so the Action can inspect the
frozen head and base commits from the pull-request event. The Action supports
`pull_request`, never `pull_request_target`.

`pull-requests: write` is needed only for PR comments. `packages: read` applies
only to private GitHub Packages images; other private registries require their
own login step.

Image inspection requires a Linux runner with Docker and BuildKit. The Action
downloads pinned, checksum-verified scanner releases as needed and caches them;
[the scanner manifest](src/scanner-manifest.ts) is the version source of truth.

## How pull requests are inspected

| Capability | Same-repository PR | Fork PR |
| --- | --- | --- |
| Docker and BuildKit | Builds and compares images | Never invoked |
| Registry access | Resolves the configured base image | Never accessed |
| Trivy image scan | Runs when enabled | Never runs |
| Syft package scan | Runs when enabled | Never runs |
| Dockerfile checks | Uses built-image metadata | Static analysis only |
| Trivy configuration scan | Not used | Static analysis only |
| Policy result | Gates are enforced | Neutral |

Same-repository PRs can receive a job summary, JSON artifact, and one bot-owned
comment. Fork PRs receive static Dockerfile and Trivy configuration findings, a
neutral policy result, a job summary, and a JSON artifact.

Fork mode never invokes Docker, BuildKit, a registry, image scanning, Syft,
repository scripts, or custom Trivy policies.

## Configuration

This example shows every available setting:

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

`targets` must contain at least one uniquely named image. Dockerfile and context
paths are relative to the configuration file and must remain inside the
repository. `baseImage` must include `${sha}` in its tag; `${owner}`, `${repo}`,
and `${sha}` are the only expanded template values.

Trivy and Syft default to enabled. Gates are optional; with no configured gates,
the Action reports findings without failing policy. Build arguments are literal
configuration values. Environment interpolation, BuildKit secrets, and SSH
forwarding are not supported.

## Action reference

Inputs:

| Input | Default | Description |
| --- | --- | --- |
| `config-path` | `.container-pr-inspector.yml` | Path to the version 1 configuration file |
| `github-token` | `${{ github.token }}` | Token used for PR comments and artifact metadata |
| `comment` | `true` | Update the bot-owned comment on same-repository PRs |
| `upload-artifact` | `true` | Upload the versioned JSON result |
| `artifact-name` | `container-pr-inspector-pr-<number>` | Override the artifact name |

Outputs:

| Output | Description |
| --- | --- |
| `conclusion` | Final inspection conclusion |
| `result-path` | Absolute path to the JSON result |
| `base-sha` | Frozen pull-request base SHA |
| `head-sha` | Pull-request head SHA |
| `base-digest` | First resolved base-image digest |
| `regression-count` | New findings across all targets |

The Action always attempts to write a job summary and result file. Artifact
upload and same-repository PR comments can be disabled with the corresponding
inputs. Fork PRs never receive a comment. The owned comment is updated through
the marker `<!-- container-pr-inspector:v1 -->`.

## JSON result

Every result uses `schemaVersion: 1` and records exact refs, resolved platform,
image digests, tool and database metadata, normalized findings, gate
evaluations, and a distinct conclusion. See the
[version 1 JSON schema](schema/result-v1.schema.json).

## Local CLI

The development CLI requires Node.js 24 or newer, Linux with Docker and
BuildKit, Trivy and Syft on `PATH`, and a local Git repository containing the
referenced commits. It is not currently published to npm.

```sh
pnpm install
pnpm build

node dist/cli.js compare \
  --base-sha "$BASE_SHA" \
  --head-sha WORKTREE \
  --config .container-pr-inspector.yml \
  --format terminal

node dist/cli.js audit \
  --ref WORKTREE \
  --config .container-pr-inspector.yml \
  --format json \
  --output result.json
```

Repository template values are resolved from `--repository owner/repo`,
`GITHUB_REPOSITORY`, or a recognizable GitHub `origin` URL, in that order.

Exit codes are `0` for pass, warning, report-only, or neutral results; `1` for
policy failure; and `2` for configuration or operational failure.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development, validation, integration
testing, generated-file, and release guidance.

## License

MIT
