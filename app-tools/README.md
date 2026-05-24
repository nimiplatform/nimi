# @nimiplatform/app-tools

Public app-authoring CLI for Nimi App projects.

```bash
pnpm dlx @nimiplatform/app-tools nimi-app create --profile standalone
pnpm dlx @nimiplatform/app-tools nimi-app doctor --dir path/to/app
pnpm dlx @nimiplatform/app-tools nimi-app update --dir path/to/app
```

`nimi-app create` emits a publishable Tauri app-authoring scaffold. The
generated project is designed to install its own dependencies with
`pnpm install`, run local checks, produce a pre-submission package artifact,
and remain directly usable without hand-editing scaffold-managed glue.

`nimi-app doctor` verifies scaffold lock state, managed glue, package-owned
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
nimi-app doctor [--dir path] [--json]
nimi-app update [--dir path] [--json]
```

Inside this monorepo, use the repo-local binary:

```bash
node ../../app-tools/bin/nimi-app.mjs create --profile standalone
```
