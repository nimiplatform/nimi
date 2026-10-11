# Development Environment Setup

This guide walks you through setting up a development environment for Nimi, targeting App Tools 0.11.4, SDK 0.21.0, Kit 0.18.0, and a matching local Runtime build. It also covers the optional Vercel AI SDK adapter (0.5.0) and Tauri carrier (0.10.0).

## Required Toolchain

- **Node.js**: Node.js 24 or newer is required (`engines.node >= 24.0.0`).
- **pnpm**: pnpm 10.34.5 (or compatible pnpm 10.x).
- **Nimi Coding**: App projects use project-local Nimi Coding (0.6.5) for specification verification, automatically initialized via `pnpm run init` after installing dependencies.

Prepare the App Tools, SDK, Kit, and matching Kit native packages for your OS and CPU architecture. These can be packaged directly from source or obtained from a development delivery bundle. Kit's native package is an optional dependency versioned alongside Kit.

## Dependency Selection

This guide explicitly uses the admitted development pair SDK `^0.21.0` and Kit `^0.18.0` (or Tauri 0.10.0 if using Tauri). Note that scaffolded templates default to `^0.18.1` / `^0.15.3`; update the two dependency declarations in `package.json` and workspace overrides accordingly.

In your project, declare dependencies in `package.json` and map them to local archives using overrides in `pnpm-workspace.yaml`. See [Create an App](/start/create-an-app) for step-by-step instructions. Keeping dependent package versions aligned ensures stability across Runtime and native interfaces.

## Running and Debugging

1. **Start Nimi Home and Runtime**: Ensure your local Nimi Home and Runtime instances are running. Nimi Home requires signing in with a Nimi account.
2. **Register and Authorize**: In Nimi Home's Developer Mode, register your local project and grant the necessary capability permissions.
3. **Launch the App**: Run `pnpm dev` in your project root to start the app inside Desktop's supervised Electron development host.

Once the window opens, ensure local loadouts and cloud connectors have been configured in Nimi Home, save your app's capability routing intent using the SDK client, and verify your end-to-end AI workflow.

To check client availability and download options across platforms, visit the [official download page](https://nimi.ai/download).

## Next Steps

- [Create an App](/start/create-an-app)
- [First AI Call](/sdk/first-ai-call)
- [AI Capability Configuration (AIConfig)](/sdk/ai-config-surface)
- [Troubleshooting Integration Issues](/start/troubleshooting)
- [Development and Distribution](/start/#local-development-and-distribution)

## Source Basis

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`app-tools/lib/app-dependency-combinations.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-dependency-combinations.mjs)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
