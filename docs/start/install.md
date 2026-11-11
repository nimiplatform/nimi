<!-- nimi-docs: {"authority":["rule.nimi.platform.governance-release.p-gov-026-positioning"],"sources":["app-tools/package.json","sdks/typescript/package.json","kit/package.json","sdks/typescript/adapters/vercel-ai/package.json","scripts/dev-app.mjs"]} -->

# Development Environment Setup

Choose the artifact and App carrier before installing dependencies. A published package and a local source archive can have the same version number while exposing different APIs.

## Choose Your Artifacts

| Artifact | Available contents and use |
| --- | --- |
| [Nimi Beta `nimi/v0.2.4`](https://github.com/nimiplatform/nimi/releases/tag/nimi%2Fv0.2.4) | Installable product for macOS arm64 and Windows x86_64. Use its release-specific compatibility and recovery instructions. Its version does not certify compatibility with later source APIs. |
| [npm SDK `0.22.2`](https://registry.npmjs.org/@nimiplatform%2fsdk/0.22.2) | Published native App interfaces; this artifact has no `runtime/remote` or `realm/runtime-client` entry. |
| [npm Kit `0.22.1`](https://registry.npmjs.org/@nimiplatform%2fkit/0.22.1) | This artifact has no `auth/app/*` or `core/app-session` entries. |
| [npm App Tools `0.14.0`](https://registry.npmjs.org/@nimiplatform%2fapp-tools/0.14.0) | Native authoring CLI; this artifact has no Web export or `--platform` entry. |
| [npm Vercel adapter `0.6.2`](https://registry.npmjs.org/@nimiplatform%2fsdk-adapter-vercel-ai/0.6.2) | Published adapter declaring SDK `^0.22.2`, AI SDK `^7.0.0` and provider `^4.0.0`. Dependency ranges alone do not verify a host/package combination. |

Use a published App Tools release and its generated dependency set for the matching native host. For the current Web and Android guides, use complete SDK, Kit and App Tools archives from the same source delivery, with a matching source Runtime and Home. Installing the npm versions above does not provide those new entries.

## Toolchain and Source Combination

Use Node `>=24.22.1 <25` and pnpm `10.34.7`. Native source builds additionally need the target OS build tools. Android has its own JDK, Android SDK, native project and device prerequisites.

The current source scaffold declares:

| Package | Source version |
| --- | --- |
| `@nimiplatform/sdk` | `^0.22.2` |
| `@nimiplatform/kit` | `^0.22.1` |
| `@nimiplatform/app-tools` | `^0.14.0` |
| `@nimiplatform/sdk-adapter-vercel-ai` | `^0.6.2` |
| `nimi-shell-tauri` | `0.11.1` |
| Project-local Nimi Coding | `0.7.0` |

## Source Package Archives

Build and package the required local archives using the [App Tools local package workflow](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md#local-development-packages). Point your standalone App's `pnpm-workspace.yaml` to the actual archive paths; the following example assumes a sibling `nimi-packages` directory:

```yaml
packages:
  - .
overrides:
  '@nimiplatform/app-tools': file:../nimi-packages/nimiplatform-app-tools-0.14.0.tgz
  '@nimiplatform/sdk': file:../nimi-packages/nimiplatform-sdk-0.22.2.tgz
  '@nimiplatform/kit': file:../nimi-packages/nimiplatform-kit-0.22.1.tgz
  '@nimiplatform/kit-protected-local-darwin-arm64': file:../nimi-packages/nimiplatform-kit-protected-local-darwin-arm64-0.22.1.tgz
```

On Windows x86_64, use the matching `kit-protected-local-win32-x64` archive instead of the Darwin package. Native optional packages must match Kit. A Web-only App does not acquire a native Host from these packages.

Run `pnpm install`, then run the App's `init`/`check`, typecheck, tests, and build. Keep the source revision and lockfile integrity with the selected delivery, and reinstall whenever an archive changes—even if its numeric version stays the same. Do not patch installed files or replace public packages with source-directory links. Creating an archive locally does not publish it to npm or verify a live Runtime call.

## Start the Source Host

Prepare the [repository environment](https://github.com/nimiplatform/nimi/blob/main/ONBOARDING.md), including Go and native tools. Source development uses local Realm at `http://127.0.0.1:3002`. Configure an existing Realm development checkout through `NIMI_DEV_REALM_DIR`, or run its required services separately; the public Nimi repository does not contain that server implementation.

From the Nimi root:

```bash
pnpm dev:desktop
```

The launcher checks and starts missing configured development services and Runtime, then opens Home. Complete data-directory setup and browser sign-in. For native App development, enable Developer Mode and launch the App through its declared `pnpm dev` entry; inspect its Nimi Access separately from host startup.

For independent Runtime debugging, `pnpm dev:runtime` runs its source supervisor in a dedicated terminal and prints logs there. Home can reuse that process. The Windows fixed-service `status`/`health` commands do not diagnose the source supervisor or establish AI readiness; see [CLI and startup paths](/runtime/cli-and-daemon).

## Next Steps

- [Create a Desktop App](/start/create-an-app)
- [First AI call](/sdk/first-ai-call)
- [Troubleshooting](/start/troubleshooting)
- [Product downloads](https://nimi.ai/download)

## Choose the Client Entry

With the host and source packages prepared, continue with the [Web App](/start/connect-web-app) or [Android App](/start/connect-android-app) guide.

## Source Basis

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`app-tools/lib/app-dependency-combinations.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-dependency-combinations.mjs)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`app-tools/package.json`](https://github.com/nimiplatform/nimi/blob/main/app-tools/package.json)
- [`sdks/typescript/package.json`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/package.json)
- [`kit/package.json`](https://github.com/nimiplatform/nimi/blob/main/kit/package.json)
- [`sdks/typescript/adapters/vercel-ai/package.json`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/adapters/vercel-ai/package.json)
- [`scripts/dev-app.mjs`](https://github.com/nimiplatform/nimi/blob/main/scripts/dev-app.mjs)
- [`runtime/cmd/nimi/runtime_health_commands.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/cmd/nimi/runtime_health_commands.go)
