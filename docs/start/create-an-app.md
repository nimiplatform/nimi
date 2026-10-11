# Create a Nimi App

This walkthrough guides you through scaffolding, initializing, and running a complete Nimi App using App Tools 0.11.4, SDK 0.21.0, and Kit 0.18.0. Ensure you have completed the [Development Setup](/start/install) and placed matching package archives in `nimi-packages` adjacent to your target directory.

## 1. Scaffold the Project

Run the following command in your terminal:

```bash
pnpm dlx --package=file:./nimi-packages/nimiplatform-app-tools-0.11.4.tgz nimi-app create --dir my-nimi-app --profile standalone --features studio-create --app-id example.app --version 0.1.0 --title "My Nimi App" --package-name my-nimi-app --author "Your Name"
cd my-nimi-app
```

- `--features studio-create`: Includes Create capabilities and adds the necessary `runtime.consume` permission declarations. Omit this only when scaffolding an empty base app without AI features.
- Replace example identifiers, titles, and author details with your project's information.

## 2. Configure Dependencies

In the generated `package.json`, ensure your `dependencies` specify the current core packages:

```json
{
  "@nimiplatform/sdk": "^0.21.0",
  "@nimiplatform/kit": "^0.18.0"
}
```

Create a `pnpm-workspace.yaml` file in the project root to map these dependencies to your local package archives:

```yaml
packages:
  - .
overrides:
  '@nimiplatform/app-tools': file:../nimi-packages/nimiplatform-app-tools-0.11.4.tgz
  '@nimiplatform/sdk': file:../nimi-packages/nimiplatform-sdk-0.21.0.tgz
  '@nimiplatform/kit': file:../nimi-packages/nimiplatform-kit-0.18.0.tgz
  '@nimiplatform/kit-protected-local-darwin-arm64': file:../nimi-packages/nimiplatform-kit-protected-local-darwin-arm64-0.18.0.tgz
```

> **Platform Note**: The native override above targets macOS arm64. On Windows x86_64, replace it with `@nimiplatform/kit-protected-local-win32-x64` and the matching version. This package is an optional native extension for Kit and does not need to be added directly to your app's dependencies.

## 3. Initialize, Check, and Run

Initialize and launch the project with the following commands:

```bash
pnpm install
pnpm run init
pnpm run check
pnpm run test
pnpm dev
```

- `init`: Generates the scaffold lock and synchronizes Nimi Coding specifications.
- `sync`: When updating dependencies or configuration later, run `pnpm run sync` to refresh managed files while preserving your custom business logic.
- `dev`: Launches your app inside the Desktop-supervised Electron development host. Register and authorize the app in Nimi Home's Developer Mode, then configure your desired AI capabilities.

## 4. Build and Distribution Packaging

When your application is ready for testing and packaging:

```bash
# macOS
pnpm run app:build -- --target macos-aarch64
pnpm run pack --target macos-aarch64 --production

# Windows
pnpm run app:build -- --target windows-x86_64
pnpm run pack --target windows-x86_64 --production
```

`pack --production` verifies platform signature and execution criteria, producing a local delivery package suitable for testing. Public release and store listing (Registry publishing) undergo the official release preflight and registry approval workflow.

## Next Steps

- [Make Your First AI Call](/sdk/first-ai-call)
- [Enhance UI with Nimi Kit](/platform/kit/use-kit-in-app)
- [Configure AI Capability Intents](/sdk/ai-config-surface)

## Source Basis

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`apps/lab/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
