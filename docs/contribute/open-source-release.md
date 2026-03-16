# Open-Source Release

This runbook fixes the public release order for Nimi open-source launches and keeps the install/update entry points aligned.

## Release Tracks

- `runtime/vX.Y.Z`: runtime GitHub release and Go module tag
- `sdk/vX.Y.Z`: `@nimiplatform/sdk` and `@nimiplatform/dev-tools`
- `desktop/vX.Y.Z`: desktop GitHub release
- `@nimiplatform/nimi` and `@nimiplatform/nimi-*`: versioned from the runtime release, not the SDK or desktop release

Nimi does not publish a separate Go registry package or Rust crate for the desktop app.

## Required GitHub Secrets And Variables

### Shared release gates

- `NIMI_LIVE_GEMINI_API_KEY`
- `NIMI_LIVE_ALIBABA_API_KEY`
- `NIMI_MODS_REPO_TOKEN` (required while `nimiplatform/nimi-mods` is private; fine-grained read access is enough)
- `NIMI_LIVE_GEMINI_MODEL_ID` (repo variable, optional fallback exists)
- `NIMI_LIVE_GOLD_SUBJECT_USER_ID` (repo variable, optional fallback `gold-user`)
- `NIMI_LIVE_ALIBABA_BASE_URL` (repo variable, optional fallback exists)
- `NIMI_LIVE_ALIBABA_CHAT_MODEL_ID` (repo variable, optional fallback exists)

### Runtime release

- No extra registry secret is required beyond `GITHUB_TOKEN`
- Runtime signing and `checksums.txt` signing use GitHub OIDC in `.github/workflows/release-runtime.yml`

### npm packages

- `NPM_TOKEN`

### Desktop release

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `NIMI_DESKTOP_UPDATER_PUBLIC_KEY` (repo variable)
- `NIMI_DESKTOP_UPDATER_ENDPOINT=https://install.nimi.xyz/desktop/latest.json` (repo variable)
- `NIMI_DESKTOP_MACOS_SIGNING_MODE` (repo variable, `developer-id` by default; set to `ad-hoc` to publish unsigned-by-Apple macOS artifacts)
- `APPLE_CERTIFICATE` (required only when `NIMI_DESKTOP_MACOS_SIGNING_MODE=developer-id`)
- `APPLE_CERTIFICATE_PASSWORD` (required only when `NIMI_DESKTOP_MACOS_SIGNING_MODE=developer-id`)
- `APPLE_SIGNING_IDENTITY` (required only when `NIMI_DESKTOP_MACOS_SIGNING_MODE=developer-id`)
- `APPLE_ID` (required only when `NIMI_DESKTOP_MACOS_SIGNING_MODE=developer-id`)
- `APPLE_PASSWORD` (required only when `NIMI_DESKTOP_MACOS_SIGNING_MODE=developer-id`)
- `APPLE_TEAM_ID` (required only when `NIMI_DESKTOP_MACOS_SIGNING_MODE=developer-id`)

### Cloudflare install gateway

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `NIMI_GITHUB_RELEASES_TOKEN` (optional but recommended for GitHub API rate limits)

## Install Gateway

`install.nimi.xyz` is served by the Cloudflare Worker in `apps/install-gateway/`.

Public endpoints:

- `https://install.nimi.xyz/`
- `https://install.nimi.xyz/runtime/latest.json`
- `https://install.nimi.xyz/desktop/latest.json`

Deploy it with the manual GitHub Actions workflow:

1. Configure the `install.nimi.xyz` custom domain for the Worker.
2. Run `.github/workflows/deploy-install-gateway.yml`.
3. Verify:
   - `curl -fsSL https://install.nimi.xyz | sh`
   - [https://install.nimi.xyz/runtime/latest.json](https://install.nimi.xyz/runtime/latest.json)
   - [https://install.nimi.xyz/desktop/latest.json](https://install.nimi.xyz/desktop/latest.json)

## Release Order

Use RC tags first for external rehearsal:

- `runtime/vX.Y.Z-rc.1`
- `sdk/vX.Y.Z-rc.1`
- `desktop/vX.Y.Z-rc.1`

Stable release order:

1. Deploy or refresh `install.nimi.xyz`.
2. Push `runtime/vX.Y.Z`.
3. Wait for `.github/workflows/release-runtime.yml` to finish.
4. Confirm the reusable npm workflow published:
   - `@nimiplatform/nimi`
   - `@nimiplatform/nimi-darwin-arm64`
   - `@nimiplatform/nimi-darwin-x64`
   - `@nimiplatform/nimi-linux-arm64`
   - `@nimiplatform/nimi-linux-x64`
   - `@nimiplatform/nimi-win32-arm64`
   - `@nimiplatform/nimi-win32-x64`
5. Push `sdk/vX.Y.Z`.
6. Wait for `.github/workflows/release.yml` to publish `@nimiplatform/sdk` and `@nimiplatform/dev-tools`.
7. Push `desktop/vX.Y.Z`.
8. Wait for `.github/workflows/release.yml` to publish desktop GitHub release assets.

## macOS Signing Modes

- `developer-id`: use Apple Developer ID signing and notarization; requires the full `APPLE_*` secret set
- `ad-hoc`: build macOS assets without Apple Developer ID notarization; set `NIMI_DESKTOP_MACOS_SIGNING_MODE=ad-hoc`

When `ad-hoc` mode is active, GitHub desktop release notes explicitly mark macOS assets as ad-hoc signed. Users may need to manually allow the app on first launch because Gatekeeper treats the bundle as unsigned by Apple.

## Dry Runs And Smoke Checks

Run these before the first public tag:

- `pnpm check:release-preflight`
- `pnpm check:npm-binary-smoke`
- `node scripts/check-install-script-smoke.mjs`
- `pnpm --filter @nimiplatform/install-gateway test`
- `pnpm --filter @nimiplatform/install-gateway build`

Use these GitHub Actions workflows for release rehearsals:

- `.github/workflows/release-runtime.yml` via `workflow_dispatch` for snapshot builds
- `.github/workflows/release.yml` via `workflow_dispatch` with `publish=false`
- `.github/workflows/desktop-release-dry-run.yml`

## Public Validation

After stable release, confirm all of the following:

- `curl -fsSL https://install.nimi.xyz | sh` installs the latest runtime on macOS and Linux even when the newest GitHub release is not a runtime release
- `npm install -g @nimiplatform/nimi` installs the correct platform package on supported macOS, Linux, and Windows targets
- the runtime GitHub release includes archives, `checksums.txt`, signatures, certificates, and SBOM assets
- the desktop GitHub release includes the current workflow outputs: macOS updater archives, Windows NSIS installer assets, Linux AppImage assets, signatures, and updater metadata
- if `NIMI_DESKTOP_MACOS_SIGNING_MODE=ad-hoc`, the desktop release notes and user docs clearly state that macOS assets are not Apple notarized yet
- [https://install.nimi.xyz/runtime/latest.json](https://install.nimi.xyz/runtime/latest.json) returns a complete runtime manifest
- [https://install.nimi.xyz/desktop/latest.json](https://install.nimi.xyz/desktop/latest.json) returns a valid desktop updater manifest
