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
and `sync`; production publication runs only from a protected version tag in
the publisher repository's managed GitHub workflow.

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

## Canonical release boundary

The production chain is singular. Its publisher GitHub Release stage is
available for explicitly configured pilot repositories; later registry and
installed lifecycle stages remain unavailable:

```text
public App repository
  -> immutable protected version tag
  -> tag-triggered publisher GitHub Actions
  -> immutable GitHub Release assets
  -> publisher-fork registry pull request
  -> human-reviewed static registry main
  -> Runtime download/install
  -> Desktop exact Host launch
```

The registry references publisher Release assets and never mirrors bytes. GitHub Release is not catalog admission; catalog admission is not installed; installed is not running; running is not Nimi Access ready.

Repository administration must enable a protected `v*` tag ruleset and GitHub immutable releases before production. A fine-grained `GITHUB_REPOSITORY_ADMIN_TOKEN` secret with repository Administration read permission lets the managed tag workflow verify those settings; it cannot enable or change them. Manual workflow dispatch runs only the non-production build/package path. On Windows, the tag-only production build imports the publisher PFX from `WINDOWS_CERTIFICATE_BASE64`/`WINDOWS_CERTIFICATE_PASSWORD`, signs the exact declared Host, and removes the temporary certificate; production pack only re-verifies Authenticode and never signs. A successful tag workflow creates the immutable publisher GitHub Release and no registry, installed, running, or Nimi Access truth. Registry submission, the shared installed carrier, and installed launch remain unavailable.

## Acceptance status

Help output and focused tests prove only the inspected implementation contract. Any dependency install, build, target pack, GitHub workflow, Release, registry review, Runtime install or Desktop launch not actually run remains `NOT-VERIFIED`. Product acceptance remains user-owned.

Published CLI usage is:

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app --help
```
