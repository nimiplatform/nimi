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
truth, signing status, or a permission grant. Paths not run in the current
development environment remain `NOT-VERIFIED`.

When `--profile tester-reference` is used, the generator emits the explicit
non-first-party developer reference tester product surface: Runtime-authenticated
shell, Nimi Kit glass workbench, typed AI capability lanes, app-owned history
storage, and standalone world-tour viewer commands. This reference app is
opt-in only; app id values never switch the scaffold profile.

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
nimi-app doctor [--dir path] --conformance simulator
nimi-app update [--dir path] [--json]
```

`doctor --conformance simulator` validates the current closed
`nimi.simulator.module/v1` input, canonical renderer-factory reachability,
Simulator renderer/Adapter/fixture source, canonical style namespace, forbidden
closure imports/effects, and scoped CSS inputs. It emits an ordinary log and
exit code. It neither selects the App nor certifies the product, artifact,
release, or Nimi App admission.

Inside this monorepo, use the repo-local binary:

```bash
node ../../app-tools/bin/nimi-app.mjs create --profile standalone
```
