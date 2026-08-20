# @nimiplatform/app-tools

Public app-authoring CLI for Nimi App projects.

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app create --profile standalone
pnpm dlx --package @nimiplatform/app-tools nimi-app init --dir path/to/app
pnpm dlx --package @nimiplatform/app-tools nimi-app doctor --dir path/to/app
pnpm dlx --package @nimiplatform/app-tools nimi-app update --dir path/to/app
```

`nimi-app create` emits an Electron-supervised local-development app-authoring scaffold. The
generated project is designed to install its own dependencies with
`pnpm install`, initialize with `pnpm run init`, run with `pnpm dev`, run local
checks, and remain directly usable without
hand-editing scaffold-managed glue.

`nimi-app init` is the explicit post-install activation step. It runs the
pinned local `nimicoding sync --apply` projection for `.nimi/{config,contracts,methodology}/**`
and writes app-scaffold lock state. It does not use
`npx` or mutate `.nimi/**` from package install side effects.

`pnpm dev` enters the official `nimi-app dev` launcher and selects Electron.
`pnpm dev:shell -- --shell electron` is the explicit equivalent. Windows and
macOS accept only the Desktop-supervised Electron carrier; Tauri is not an
admitted local-development path. Nimi Desktop shows the canonical project, app
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

Profiles control dependency topology only: `standalone` uses public package
versions, while `workspace-app` uses workspace and repository-local dependency
links. Feature selection is independent of the profile. The current admitted
catalog contains `kit-recipes`, extracted from the real Nimi Lab UI Recipes
surface. `--features all` currently expands to that exact one-item catalog; it
does not copy the full Lab. AI consume, Realm, Local Agent, diagnostics, and
other Lab surfaces remain non-selectable until their own real Lab journey and
generated-App closure are complete. The full Lab App is not a scaffold profile
or template; implementation presence in `apps/lab` is not admission.

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
nimi-app create [--dir path] [--profile standalone|workspace-app] [--features ids|all] [--app-id id] [--title title] [--package-name name] [--author author]
nimi-app dev [--dir path] [--shell electron] [--cdp-port 1024..65535]
nimi-app init [--dir path] [--json]
nimi-app doctor [--dir path] [--json]
nimi-app doctor [--dir path] --conformance simulator
nimi-app update [--dir path] [--json]
```

`dev --cdp-port <port>` asks the Desktop supervisor to expose that App's
Electron DevTools protocol on `127.0.0.1` for the current run. The option is
explicit and development-only; omitting it keeps CDP disabled.

`doctor --conformance simulator` validates the current closed
`nimi.simulator.module/v1` input, canonical renderer-factory reachability,
Simulator renderer/Adapter/fixture source, canonical style namespace, forbidden
closure imports, and scoped CSS inputs. It emits an ordinary log and
exit code. It neither selects the App nor certifies the product, artifact,
release, or Nimi App admission.

Inside this monorepo, use the repo-local binary:

```bash
node ../../app-tools/bin/nimi-app.mjs create --profile standalone
```
