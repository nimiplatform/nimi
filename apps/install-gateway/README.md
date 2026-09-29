# Nimi Install Gateway

Cloudflare Worker serving release distribution.

## Overview

Install Gateway is a Cloudflare Worker that serves the Runtime install script and Runtime release manifest. It fetches Runtime release data from the GitHub API, validates archive checksums, and serves the fixed Runtime distribution routes.

`/runtime/latest.json` considers only stable Runtime-only releases tagged `runtime/v<SemVer>`. Complete Nimi bundles (`nimi/v`), Desktop, component and bare `v<SemVer>` tags belong to other owners and never enter this feed. A release qualifies only when all six platform archives and `checksums.txt` are uploaded, `checksums.txt` matches GitHub's digest of that asset, and each archive's checksum matches GitHub's digest of the archive. The highest qualifying version is served; when none qualifies the route returns `404` with `RUNTIME_RELEASE_NOT_FOUND`, and GitHub read failures return `502`.

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
