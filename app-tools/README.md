# `@nimiplatform/app-tools`

`app-tools` is the public full-stack developer toolkit for third-party Nimi Apps. It owns repository scaffolding, dependency and managed-file synchronization, local validation, Desktop-supervised development, App-declared test/build orchestration, deterministic packaging, and managed GitHub workflow setup.

It does not own GitHub publisher or repository truth, registry review/main, Runtime installed state, Desktop process state, or Nimi Access. Nimi Account and the private Nimi backend are not publisher credentials or App-release infrastructure.

## Command family

The public CLI has exactly eight commands:

```text
create -> dependency install -> init -> sync -> check
       -> dev / test / build -> pack
```

- `create` writes a standalone private App project with a dotted App ID, exact version, public dependency declarations, developer build/submission inputs and one managed workflow. It does not install dependencies or create admission truth.
- `init` materializes package-owned projections and the scaffold lock after dependencies are installed.
- `sync` refreshes only scaffold-managed dependencies, configuration, workflow and glue. App-owned product code is preserved.
- `check` is non-mutating and incorporates the former scaffold validation behavior.
- `dev` requests the official Desktop-supervised Electron development Host.
- `test` and `build` execute the real owner commands declared in `.nimi/config/build-profile.yaml`; there is no fallback success.
- `pack` is the sole local/CI `.nimiapp` packaging owner and never uploads.

`doctor`, `update`, and local `publish` are absent without aliases. Use `check`
and `sync`; production publication runs only from a protected version tag whose
commit is already contained in the publisher repository's canonical default
branch, through the managed GitHub workflow.

Run the checked-in CLI help for the admitted feature catalog and exact options:

```bash
node app-tools/bin/nimi-app.mjs --help
```

## Create

Interactive use validates every field, shows the resolved plan and asks for confirmation. The optional `author` names one person or team. Non-interactive use supplies the same inputs directly:

```bash
node app-tools/bin/nimi-app.mjs create \
  --dir path/to/app \
  --profile standalone \
  --app-id example.app \
  --version 0.1.0 \
  --title "Example App" \
  --package-name example-app \
  --author "Example Team"
```

The base is identity-neutral and combines only explicitly admitted `--features` plus their dependency closure. `--features all` means all currently admitted features, not all Nimi Lab source.

Standalone output uses public npm and Cargo dependency versions. Workspace paths, local tarballs, parent-source aliases and direct native-carrier dependencies are non-public validation topology, not a public profile or standalone release input.

## Development and build

After creation:

```bash
cd path/to/app
pnpm install
pnpm run init
pnpm run sync
pnpm run check
pnpm run test
pnpm run app:build -- --target windows-x86_64
pnpm dev
```

`dev` uses the Desktop supervisor. Direct Electron, Tauri or renderer launch cannot claim protected Nimi access. Process running and Nimi Access ready remain separate states.

The default `windows-x86_64` build profile runs `build:electron:production`. It rebuilds the renderer and Electron main/preload, then creates a fresh, non-installer `dist-electron-package/<app>-shell-win32-x64/` directory with `asar` disabled and an App-specific `<app>-shell.exe`. The production main bundle has a compile-time production marker and rejects every `--nimi-dev-renderer-url` argument; packaged renderer assets stay relative under `dist/`. The protected native binding is resolved from Kit's optional dependency and is never declared directly by the App.

Tauri remains an explicit alternative through `pnpm run build:tauri:production`; selecting it requires an explicit Tauri build profile rather than changing the default Electron carrier.

## Canonical release boundary

The Registry publication chain uses the stages below. Publisher GitHub Release
is available for configured pilot repositories; protected Registry admission and
verified installation, launch and uninstall are available on Windows x86_64:

```text
public App repository
  -> reviewed canonical default-branch commit
  -> immutable protected version tag
  -> tag-triggered publisher GitHub Actions
  -> immutable GitHub Release assets
  -> publisher-fork registry pull request
  -> human-reviewed static registry main
  -> Runtime download/install
  -> Desktop exact Host launch
```

The registry references publisher Release assets and never mirrors bytes. GitHub Release is not catalog admission; catalog admission is not installed; installed is not running; running is not Nimi Access ready.

Repository administration must enable a protected `v*` tag ruleset and GitHub immutable releases before production. The managed tag workflow fetches the repository's canonical default branch and rejects a tag commit outside that history before production preflight, build, attestation, or Release. A fine-grained `NIMI_REPOSITORY_ADMIN_TOKEN` secret with repository Administration read permission lets the workflow verify protected-tag and immutable-release settings; it cannot enable or change them. Manual workflow dispatch runs only the non-production build/package path. On Windows, the tag-only production build invokes the App-declared production build with no certificate-secret mapping or app-tools-owned signing step. Optional native signing remains publisher-owned and must already be reflected in the final exact Runtime entry before production pack observes and records its native-trust posture; a present invalid or unresolved signature still fails closed. A successful tag workflow creates the immutable publisher GitHub Release and no registry, installed, running, or Nimi Access truth. Protected Registry submission and approved Windows x86_64 installation, launch/focus/stop, current-session Nimi Access and uninstall are available through their Platform, Runtime and Desktop owners. Other-platform installed lifecycle, ordinary update and repair remain unavailable. Explicit immutable local-package import remains a separate product path whose entry is not yet implemented.

Registry projects must be open source with an explicit license and reviewable release source. Consistently observed unsigned packages are eligible; invalid signatures cannot be downgraded to unsigned. These Registry admission requirements do not apply to user-imported packages or Developer Mode projects. Registry approval is not a guarantee that third-party code is harmless.

## Acceptance status

Help output and focused tests prove only the inspected implementation contract. Any dependency install, build, target pack, GitHub workflow, Release, registry review, Runtime install or Desktop launch not actually run remains `NOT-VERIFIED`. Product acceptance remains user-owned.

Published CLI usage is:

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app --help
```
