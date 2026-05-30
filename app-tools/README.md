# @nimiplatform/app-tools

Public app-authoring CLI for Nimi App projects.

```bash
pnpm dlx @nimiplatform/app-tools nimi-app create --profile standalone
pnpm dlx @nimiplatform/app-tools nimi-app init --dir path/to/app
pnpm dlx @nimiplatform/app-tools nimi-app doctor --dir path/to/app
pnpm dlx @nimiplatform/app-tools nimi-app update --dir path/to/app
```

`nimi-app create` emits a publishable Tauri app-authoring scaffold. The
generated project is designed to install its own dependencies with
`pnpm install`, initialize with `pnpm run init`, run with `pnpm dev:shell`, run local checks, produce a
developer-submitted Nimi listing packet, and remain directly usable without
hand-editing scaffold-managed glue.

`nimi-app init` is the explicit post-install activation step. It runs the
pinned local `nimicoding sync --apply` projection for `.nimi/{config,contracts,methodology}/**`
and writes app-scaffold admission/build-profile/lock state. It does not use
`npx` or mutate `.nimi/**` from package install side effects.

`pnpm dev:shell` launches the Tauri shell (`tauri dev`). The generated app
authenticates through the in-app Runtime account login, exactly like a shipped
app — there is no standalone developer session. For a not-yet-admitted local
app, enable Developer Mode in the desktop app; the Runtime developer-registration
gate then admits the local app under a real logged-in account. This is local
development material only; it is not listing admission, installed-app truth, or a
permission grant.

When `--app-id nimi.tester` is used, the generator emits the first-party
developer tester product surface: Runtime-authenticated shell, Nimi Kit glass
workbench, typed AI capability lanes, app-owned history storage, standalone
world-tour viewer commands, and local acceptance tests. It is not a summary-card
starter page.

`nimi-app doctor` verifies scaffold init/lock state, managed glue, package-owned
projections, dependency alignment, and forbidden shortcut patterns in a source
checkout. `nimi-app update` refreshes scaffold-managed files while preserving
app-owned product code.

The CLI does not create public admission truth, permission grants, registry
visibility, release descriptors, or installed-app update truth. Platform review
owns those outcomes.

## Install

```bash
pnpm add -D @nimiplatform/app-tools
pnpm add @nimiplatform/sdk @nimiplatform/kit
```

## Commands

```bash
nimi-app create [--dir path] [--profile standalone|workspace-app] [--app-id id] [--title title] [--package-name name] [--author author]
nimi-app init [--dir path] [--json]
nimi-app doctor [--dir path] [--json]
nimi-app update [--dir path] [--json]
```

Inside this monorepo, use the repo-local binary:

```bash
node ../../app-tools/bin/nimi-app.mjs create --profile standalone
```
