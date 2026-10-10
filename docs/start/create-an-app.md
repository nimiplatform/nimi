# Create a Nimi App

This walkthrough uses the current App Tools 0.11.4 source and the SDK 0.21.0 / Kit 0.18.0 combination. Prepare the [matching Home, Runtime, toolchain, and complete local packages](/start/install) first. Put the package archives in `nimi-packages` beside the directory where the new App will be created.

## Create

```bash
pnpm dlx --package=file:./nimi-packages/nimiplatform-app-tools-0.11.4.tgz nimi-app create --dir my-nimi-app --profile standalone --features studio-create --app-id example.app --version 0.1.0 --title "My Nimi App" --package-name my-nimi-app --author "Your Name"
cd my-nimi-app
```

`studio-create` supplies the Create feature and its `runtime.consume` declaration. Omit it only for an empty base App, which has no AI capability access declaration. Change the example identity, title, and author for your project.

## Select Packages Before Installing

In the generated `package.json`, change only these two entries inside `dependencies`, preserving the other dependencies and scripts. Create `pnpm-workspace.yaml` with the overrides below:

```json
{
  "@nimiplatform/sdk": "^0.21.0",
  "@nimiplatform/kit": "^0.18.0"
}
```

```yaml
packages:
  - .
overrides:
  '@nimiplatform/app-tools': file:../nimi-packages/nimiplatform-app-tools-0.11.4.tgz
  '@nimiplatform/sdk': file:../nimi-packages/nimiplatform-sdk-0.21.0.tgz
  '@nimiplatform/kit': file:../nimi-packages/nimiplatform-kit-0.18.0.tgz
  '@nimiplatform/kit-protected-local-darwin-arm64': file:../nimi-packages/nimiplatform-kit-protected-local-darwin-arm64-0.18.0.tgz
```

The native override shown is for macOS arm64. On Windows x86_64 use `@nimiplatform/kit-protected-local-win32-x64` and its matching 0.18.0 archive instead. Use the actual archive filenames and complete matching native/Runtime build, not a renamed older binary. Keep the native package as Kit's optional dependency, not an App-owned direct dependency.

## Initialize, Check, and Run

```bash
pnpm install
pnpm run init
pnpm run check
pnpm run test
pnpm dev
```

`init` creates the scaffold lock and synchronizes the selected dependency combination and Nimi Coding integration. It requires the project's installed Nimi Coding package. `sync` is for an already initialized project; after a dependency change, run `sync`, install again if the manifest changed, then `check`.

`dev` requests the Desktop-supervised Electron Host. Register and authorize the project in Home's Developer Mode and configure its AI capabilities. Keep the generated `getNimiLocalAppClient()` binding. Direct renderer startup does not establish Nimi access.

The manifest is managed from selected features: do not hand-edit `app_access` to bypass the scaffold contract. Current `sync` has no `--features` flag. If you need this walkthrough's feature in an empty scaffold, create a new project with the shown feature selection while preserving the original project.

## Build and Package

```bash
pnpm run app:build -- --target macos-aarch64
pnpm run pack --target macos-aarch64 --production
```

Use `windows-x86_64` on the matching Windows host. Production-shaped local packages must satisfy the target's signing and execution requirements. `pack --production` observes those requirements; it does not publish, grant Registry admission, or run the registry-only release preflight. Plain development packages are not accepted by Runtime local import.

Tauri is an explicitly configured production alternative with partial shell coverage, not the development Host. See [Kit](/platform/kit/) for its unavailable operations.

Continue with [First AI Call](/sdk/first-ai-call). Public release requires registry-resolved dependencies, production preflight, publisher release, and separate Registry admission; local archives remain a development delivery path.

## Source Basis

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`apps/lab/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
