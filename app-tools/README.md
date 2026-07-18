# @nimiplatform/app-tools

Public app-authoring CLI for Nimi App projects.

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app create --profile standalone
pnpm dlx --package @nimiplatform/app-tools nimi-app init --dir path/to/app
pnpm dlx --package @nimiplatform/app-tools nimi-app doctor --dir path/to/app
pnpm dlx --package @nimiplatform/app-tools nimi-app update --dir path/to/app
```

`nimi-app create` emits a publishable Tauri app-authoring scaffold. The
generated project is designed to install its own dependencies with
`pnpm install`, initialize with `pnpm run init`, run with `pnpm dev`, run local checks, produce a
developer-submitted Nimi listing packet, and remain directly usable without
hand-editing scaffold-managed glue.

`nimi-app init` is the explicit post-install activation step. It runs the
pinned local `nimicoding sync --apply` projection for `.nimi/{config,contracts,methodology}/**`
and writes app-scaffold admission/build-profile/lock state. It does not use
`npx` or mutate `.nimi/**` from package install side effects.

`pnpm dev` enters the official `nimi-app dev` launcher and selects Tauri by
default. `pnpm dev:shell -- --shell electron` and `pnpm dev:shell -- --shell
tauri` select a shell explicitly. On Windows, both admitted shell intents are
accepted. On macOS, only `--shell electron` is accepted; the independent Tauri
carrier remains fail-closed. Nimi Desktop shows the canonical project, app
identity, shell, current account, and requested capabilities. The user may
allow only this run, remember the project, or deny.
Desktop then owns the dev server and native host lifecycle; ordinary direct
shell launches remain untrusted.

Remembered authorization is bound to the canonical project, app id, shell,
account, and capability fingerprint. Renderer HMR and Desktop-controlled native
host rebuilds do not prompt again. App id, project root, shell, account, or
capability expansion requires a new decision. Runtime credentials and protected
session material never enter the project, terminal, or renderer. The current
local-development surface admits only typed Runtime artifact reads requested in
`nimi.app.yaml`; other protected surfaces remain fail-closed. Local-development
authorization is not listing admission, a production release, installed-app
truth, signing evidence, or a permission grant. macOS intent submission does
not make the carrier positive: signed Runtime/Desktop/host and native live
admission still fail closed until their conjunctive gate passes.

When `--profile tester-reference` is used, the generator emits the explicit
non-first-party developer reference tester product surface: Runtime-authenticated
shell, Nimi Kit glass workbench, typed AI capability lanes, app-owned history
storage, standalone world-tour viewer commands, and local acceptance tests. This
proof app is opt-in only; app id values never switch the scaffold profile.

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
nimi-app create [--dir path] [--profile standalone|workspace-app|tester-reference] [--app-id id] [--title title] [--package-name name] [--author author]
nimi-app dev [--dir path] [--shell electron|tauri]
nimi-app init [--dir path] [--json]
nimi-app doctor [--dir path] [--json]
nimi-app update [--dir path] [--json]
```

Inside this monorepo, use the repo-local binary:

```bash
node ../../app-tools/bin/nimi-app.mjs create --profile standalone
```
