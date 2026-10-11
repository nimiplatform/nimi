# Nimi Install Gateway

Cloudflare Worker serving release distribution.

## Overview

Install Gateway is a lightweight Cloudflare Worker responsible for serving the official Nimi Runtime installation scripts and release manifests. It retrieves release metadata from the GitHub Releases API, verifies cryptographic checksums, and provides high-availability distribution endpoints.

### Release Ingestion Rules

The `/runtime/latest.json` endpoint distributes stable Runtime releases tagged with `runtime/v<SemVer>`:
- **Scope Isolation:** Full Nimi suite releases (`nimi/v`), Desktop installer tags, and independent components are tracked separately and excluded from this runtime-specific feed.
- **Verification Criteria:** A release is validated only when all target platform binaries and their corresponding `checksums.txt` digest file are present and cryptographically verified against GitHub asset digests.
- **Serving Behavior:** Returns the latest verified version. If no qualifying releases are found, the endpoint returns a `404` with code `RUNTIME_RELEASE_NOT_FOUND`; upstream API failures return a `502`.

## Tech Stack

- Pure ESM (no build transpilation)
- Node.js test runner
- Wrangler (deployment)

## Architecture

```text
src/
├── index.mjs          # Worker entry and route handler
└── release-feed.mjs   # GitHub release data fetching and caching
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
| `build` | Build step (no-op for pure ESM) |
| `deploy` | Deploy to Cloudflare |
| `test` | Run tests |
