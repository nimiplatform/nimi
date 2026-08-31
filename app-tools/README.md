# `@nimiplatform/app-tools`

`app-tools` is the public full-stack developer toolkit for third-party Nimi Apps. It owns repository scaffolding, dependency and managed-file synchronization, local validation, Desktop-supervised development, App-declared test/build orchestration, deterministic packaging, managed GitHub workflow setup, release observation and registry-submission preparation.

It does not own GitHub publisher or repository truth, registry review/main, Runtime installed state, Desktop process state, or Nimi Access. Nimi Account and the private Nimi backend are not publisher credentials or App-release infrastructure.

## Command family

The public CLI has exactly nine commands:

```text
create -> dependency install -> init -> sync -> check
       -> dev / test / build -> pack -> publish
```

- `create` writes a standalone private App project with a dotted App ID, exact version, public dependency declarations, developer build/submission inputs and one managed workflow. It does not install dependencies or create admission truth.
- `init` materializes package-owned projections and the scaffold lock after dependencies are installed.
- `sync` refreshes only scaffold-managed dependencies, configuration, workflow and glue. App-owned product code is preserved.
- `check` is non-mutating and incorporates the former scaffold validation behavior.
- `dev` requests the official Desktop-supervised Electron development Host.
- `test` and `build` execute the real owner commands declared in `.nimi/config/build-profile.yaml`; there is no fallback success.
- `pack` is the sole local/CI `.nimiapp` packaging owner and never uploads.
- `publish` is the GitHub tag/Actions/Release/registry-PR orchestration command. Local artifact upload, Account bearer auth and private candidate APIs are forbidden.

`doctor` and `update` are retired without aliases. Use `check` and `sync`.

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

The production chain is singular:

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

Repository administration must enable a protected `v*` tag ruleset and GitHub immutable releases before production. A fine-grained `GITHUB_REPOSITORY_ADMIN_TOKEN` secret with repository Administration read permission lets the tag workflow verify those settings; it cannot enable or change them. Manual workflow dispatch is dry-run only, even when dispatched against a tag ref. On Windows, `build --production` imports the publisher PFX from `WINDOWS_CERTIFICATE_BASE64`/`WINDOWS_CERTIFICATE_PASSWORD`, signs the exact declared Host, and removes the temporary certificate; `pack --production` only re-verifies Authenticode and never signs. Production also remains fail-closed until the shared installed carrier is implemented.

## Acceptance status

Help output and focused tests prove only the inspected implementation contract. Any dependency install, build, target pack, GitHub workflow, Release, registry review, Runtime install or Desktop launch not actually run remains `NOT-VERIFIED`. Product acceptance remains user-owned.

Published CLI usage is:

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app --help
```
