# Create A Nimi App

Use `@nimiplatform/app-tools` when you want a developer repository for a Nimi
App. The CLI creates scaffold inputs and local checks. It does not grant public
admission, permissions, registry visibility, release descriptors, or installed
app update truth.

## Create The Scaffold

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app create --dir my-nimi-app --profile standalone
cd my-nimi-app
pnpm install
pnpm run init
```

`standalone` is the external developer repository layout. It creates a
candidate app repository with project configuration and submitted manifest
input; those files do not become Nimi product authority. `workspace-app` is an
internal monorepo layout for an app under `apps/<app>/`, not an admitted
app-local spec slice or a user-facing product profile.

## Run And Check It Locally

```bash
pnpm dev:shell
pnpm run validate
pnpm run local-audit
pnpm run doctor
```

`pnpm dev:shell` launches the generated Tauri shell. The native host injects the
standard-shell local-app carrier. A local not-yet-admitted project must be
authorized through Developer Mode and launched as an isolated
`local_development` build. The scaffold owns no principal, grant, session, or
Runtime account custody.

If you only need to verify SDK access to Runtime-backed text generation, read
[First AI Call](/sdk/first-ai-call).

If you are wiring shared UI, auth, shell, telemetry, or AIConfig composition,
read [Use Kit In An App](/platform/kit/use-kit-in-app).

## What The Scaffold Owns

| File or command | Meaning |
| --- | --- |
| `nimi.app.yaml` | Developer-submitted manifest input, not admitted descriptor truth |
| `pnpm run init` | Explicit scaffold activation and `.nimi/{config,contracts,methodology}` projection |
| `pnpm run doctor` | Scaffold state, dependency alignment, managed glue, and projection drift check |
| `pnpm run update` | Refresh scaffold-managed glue while preserving app-owned product code |
| `pnpm run local-audit` | Local pre-submission evidence, not platform admission |

## Reference App

`apps/tester/` is the Nimi Lab developer reference app. It shows a Runtime
authenticated shell, Kit workbench surfaces, AI capability lanes, app-owned
history storage, and local acceptance checks. Treat it as a reference for SDK,
Kit, app-tools, and Runtime auth integration, not as platform admission truth.
For a reading map, see [Use Tester As A Reference App](/start/use-tester-as-reference).

## Source Basis

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`apps/tester/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/README.md)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
