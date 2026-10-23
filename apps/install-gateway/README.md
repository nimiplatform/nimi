# Nimi Install Gateway

Cloudflare Worker serving release distribution.

## Overview

Install Gateway serves the Runtime install script, Runtime release manifests, and signed Nimi product update manifests. It retrieves release metadata from the GitHub Releases API and validates the selected release before caching a successful response. All routes accept only `GET`; other methods return `405`, including when a response is already cached.

### Release Ingestion Rules

The `/runtime/latest.json` endpoint distributes stable Runtime releases tagged with `runtime/v<SemVer>`:
- **Scope Isolation:** Full Nimi suite releases (`nimi/v`), Desktop installer tags, and independent components are tracked separately and excluded from this runtime-specific feed.
- **Verification Criteria:** A release is validated only when all target platform binaries and their corresponding `checksums.txt` digest file are present and cryptographically verified against GitHub asset digests.
- **Serving Behavior:** Returns the latest verified version. If no qualifying releases are found, the endpoint returns a `404` with code `RUNTIME_RELEASE_NOT_FOUND`; upstream API failures return a `502`.

The `/nimi/{channel}/{target}/latest.json` endpoint serves signed product update envelopes from immutable `nimi/v<SemVer>` releases. Supported channels are `stable` and `beta`; targets are `macos-arm64` and `windows-amd64`. The gateway verifies the publisher signature, release identity, target, freshness, and asset metadata. A selected-channel verification failure returns an error without falling back to an older release. Missing releases return `404`; missing trust configuration returns `503`.

## Tech Stack

- Pure ESM (no build transpilation)
- Node.js test runner
- Wrangler (deployment)

## Architecture

```text
src/
├── index.mjs                 # Worker routes, method validation, and response cache
├── release-feed.mjs          # GitHub release discovery and Runtime manifests
└── product-release-feed.mjs  # Signed Nimi product update manifests
```

- Release data sourced from GitHub API.
- Caching via Cloudflare Cache API.
- Checksum validation required for all served artifacts.

## Development

```bash
pnpm -C apps/install-gateway run test
```

## Deployment

```bash
pnpm -C apps/install-gateway run deploy
```

## Scripts

| Command | Description |
|---|---|
| `build` | Copy `scripts/install.sh` into `dist/assets/install.sh` for Worker asset serving |
| `deploy` | Prepare the install-script asset and deploy with Wrangler |
| `test` | Run tests |
