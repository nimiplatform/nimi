# @nimiplatform/app-tools

`@nimiplatform/app-tools` is the canonical CLI for creating and maintaining local-development Nimi App source projects. It generates a positive composition:

```text
identity-neutral Lab-derived workbench-core
+ selected admitted coarse features
+ internal dependency closure
+ generated target glue
```

It does not copy the full Nimi Lab and remove files, hide unselected products behind runtime flags, or create platform admission, permission, listing, release, install, or update truth.

## Current catalog

Run the checked-in CLI to see the current lifecycle projection:

```bash
node app-tools/bin/nimi-app.mjs --help
```

The help output is generated from the single module registry. Only entries shown under `Admitted features` may be passed to public `create`; `--features all` expands only that exact ordered set. Entries shown as candidates are not publicly selectable, and internal modules are never directly selectable. When the admitted set is empty, `all` fails closed.

The coarse inventory is:

- `studio-create`: Create — text generation, chat stream, and embeddings.
- `studio-media`: Media — image and video generation.
- `studio-voice`: Voice — synthesis, transcription, voice creation, and speech bundle.
- `kit-recipes`: UI Recipes.
- `ai-studio-core`: internal shared composer, configuration, history, artifact, loading, error, and result product code used once by selected AI features.

The generated base is the identity-neutral, Lab-derived `workbench-core` with an empty module registry and target adapter. Lab-only Settings/account, App Access diagnostics, Realm/Agent probes, World Tour, and native or diagnostic surfaces do not enter generated Apps.

## Create

The interactive wizard and flags use the same resolver and generator. The canonical identity inputs are App ID, Display Name, package name, optional `author`, and features. `author` is the only authoring metadata field and may name either a person or a team; there is no separate team field. Public creation is standalone-only for third-party repositories.

Run `node app-tools/bin/nimi-app.mjs create` in a TTY for the keyboard-driven wizard. It validates each field, prints the complete resolved preview, requires confirmation, and accepts `:cancel` before materialization. For non-interactive automation, pass explicit flags and optional `--json`; non-TTY execution never opens prompts and the canonical resolver applies only its documented defaults.

```bash
node app-tools/bin/nimi-app.mjs create \
  --dir path/to/app \
  --profile standalone \
  --app-id example.app \
  --title "Example App" \
  --package-name example-app \
  --author "Example Team"
```

Add `--features <admitted-id,...>` only for IDs currently listed as admitted by `--help`. `--features all` is admitted-only, not the complete candidate inventory and not the full Lab.

After the requested identity, topology, module closure, ownership, and dependency projections validate, `create` writes source and `.nimi/app-scaffold/intent.json`. It does not install dependencies or run lifecycle commands.

## Third-party topology

Public `create` is standalone-only: the target may be any empty or missing directory in a third-party repository, and generated npm and Cargo dependencies use only their declared public registry versions. Public-registry publication is a prerequisite. Workspace paths, local path overrides, tarballs, downgrades, and workspace links are not standalone evidence.

The published app-tools `package.json` field `nimiScaffoldVersions` is the single release projection for every generated dependency version; generator code does not carry a second version table. The app-tools build derives Nimi-owned package, CLI, Cargo, and package-manager versions from their canonical repository manifests before prepack.

Pre-publication Nimi-workspace checks may exercise the same candidate resolver and generated files as a bounded non-public validation topology. They are not a public profile, generated intent variant, or substitute for standalone acceptance. If a required version is not public, standalone remains externally blocked and `NOT-VERIFIED`.

## Required lifecycle order

Run the real workflow in this order:

```bash
# 1. create
node app-tools/bin/nimi-app.mjs create --dir path/to/app

# 2. install
cd path/to/app
pnpm install

# 3. initialize the supported projection
pnpm run init

# 4. inspect, build, and launch
pnpm run doctor
pnpm run build
pnpm run build:electron
pnpm dev
```

`init`, `doctor`, and `update` must run only after dependency installation. `init` invokes the pinned project-local `nimicoding sync --apply` and writes the exact-version scaffold lock. Package installation itself does not mutate `.nimi/**`.

`doctor` checks supported intent/lock state, managed glue, package-owned projections, dependency alignment, ownership, and forbidden shortcut patterns. `update` refreshes only scaffold-managed output for the same immutable identity and feature selection. Neither command overwrites app-owned product code.

## Ownership

- App-owned: the shared `workbench-core`, selected product modules under `src/capabilities/**`, and product edits made by the App author.
- Scaffold-managed: carrier/auth wiring, identity, manifests, bounded native glue, project tooling, and `src/scaffold/generated/**` composition files.
- Package-owned projection: `.nimi/{config,contracts,methodology}/**`, written by the pinned `nimicoding` package during explicit initialization.

The generator validates exact, case-folded, file/directory-prefix, view, navigation, style, asset, dependency, and ownership collisions before creating a target. A filesystem failure after writing begins is reported with the exact residual target; it is not described as transactionally atomic.

## Development

`pnpm dev` enters the official Desktop-supervised Electron launcher. The explicit equivalent is:

```bash
pnpm dev:shell -- --shell electron
```

CDP is enabled by default on an automatically selected loopback port. The launcher
prints the resolved endpoint after Electron binds it. For a stable observation port:

```bash
pnpm dev -- --cdp-port 9334
```

Set `NIMI_APP_DEV_CDP_PORT=9334` in the project `.env` for the same stable override,
or pass `--no-cdp` to disable CDP. The CLI option takes precedence over `.env`.
Nimi Desktop owns the renderer and native-host lifecycle. Runtime credentials,
protected session material, permission grants, and installed-App truth do not enter
the project or renderer.

## Acceptance status

Creating a tree, printing help, passing focused tests, or observing CDP reachability does not prove product acceptance. Until real install, init, doctor, build, Electron build, Desktop-supervised launch, and principal interactions have run for the required matrix, those paths remain `NOT-VERIFIED`. Implementation and release acceptance must not be reported as PASS from this documentation alone.

After the relevant package versions are public, the installed CLI form is:

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app --help
pnpm dlx --package @nimiplatform/app-tools nimi-app create
```
