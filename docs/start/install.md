# Current Development Setup

Use the current Nimi source and a matching set of complete packages. These guides target App Tools 0.11.4, SDK 0.21.0, Kit/native 0.18.0, and the matching Runtime. The optional Vercel AI SDK adapter is 0.5.0; the optional Tauri carrier is 0.10.0. These are checkout versions, not a claim that they are already public registry releases.

## Required Toolchain

Use Node.js 24 or newer and pnpm 10.34.5. App projects also declare project-local Nimi Coding 0.6.3, initialized explicitly by `pnpm run init` after dependency installation.

Have complete App Tools, SDK, Kit, and the matching Kit native package for your host. Use the current source's component packaging workflow or a matching package delivery; do not link production App dependencies to source directories or substitute an older registry package when a current archive is missing. Kit's native optional package is versioned with Kit.

## Select the Current Combination

App Tools 0.11.4 currently generates SDK `^0.18.1` / Kit `^0.15.3` by default. To use the current interfaces in these guides, explicitly change the generated App's dependency declarations to SDK `^0.21.0` / Kit `^0.18.0` before initialization. That combination is admitted by the current App Tools dependency matrix, including Tauri 0.10.0 when used. Initialization/synchronization preserves an explicitly selected admitted pair.

Keep registry version declarations in `package.json`; supply the complete local archives through `pnpm-workspace.yaml` overrides. See [Create an App](/start/create-an-app) for the full sequence. Independent package upgrades or matching version numbers alone do not establish matching Runtime/native behavior.

## Run Through Nimi Home

A matching Nimi Home development instance and Runtime must be available. Home requires a Nimi account and browser sign-in. Register and authorize the App through Developer Mode, then use `pnpm dev` in the App project to request its Desktop-supervised Electron Host.

A visible App window does not prove Nimi Access or AI configuration is ready. Configure the App's capability through its host-bound client, prepare the machine's selected Local Loadout or exact Cloud target, and run a real request. Direct Vite or ordinary loopback gRPC does not replace the protected Host.

Check the [Download page](https://nimi.ai/download) for public installer availability. Creating an App project does not install Home, publish an App, or grant Registry admission.

## Next Steps

- [Create an App](/start/create-an-app)
- [First AI Call](/sdk/first-ai-call)
- [AIConfig](/sdk/ai-config-surface)
- [Troubleshooting](/start/troubleshooting)
- [Development and distribution](/start/#local-development-and-distribution)

## Source Basis

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`app-tools/package.json`](https://github.com/nimiplatform/nimi/blob/main/app-tools/package.json)
- [`app-tools/lib/app-dependency-combinations.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-dependency-combinations.mjs)
- [`app-tools/lib/app-scaffold.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-scaffold.mjs)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
