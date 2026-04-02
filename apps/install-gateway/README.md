# Nimi Install Gateway

Cloudflare Worker serving release distribution.

## Overview

Install Gateway is a Cloudflare Worker that serves install scripts, platform manifests, and updater metadata for Nimi releases. It fetches release data from the GitHub API, validates checksums, and serves platform-specific assets.

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
