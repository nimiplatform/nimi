# Development Setup And Availability

For a third-party Nimi App, prepare the project toolchain first. Running the App with Nimi capabilities also requires a compatible Nimi Home development instance and Runtime.

## Create And Check An App Project

Use Node.js 24 or newer and pnpm, then follow [Create a Nimi App](/start/create-an-app). That guide pins App Tools 0.2.7 so its commands and generated dependencies can be checked against the same release.

| Component | App Tools 0.2.7 generates | What you use it for |
| --- | --- | --- |
| `@nimiplatform/app-tools` | `^0.2.7` | Create, initialize, synchronize, check, run, test, build, and package the App |
| `@nimiplatform/sdk` | `^0.9.0` | Public Nimi capability interfaces |
| `@nimiplatform/nimi-coding` | `0.6.1` | The managed projections checked and synchronized by App initialization/tooling |
| `@nimiplatform/kit` | The version declared by the generated project | Shared App UI and host integration |

These are the published scaffold's declarations, not a recommendation to upgrade each dependency independently. If you choose a different App Tools release, follow that release's generated manifest and help. The Nimi workspace currently has App Tools 0.2.8 with SDK `^0.10.0` and nimicoding `0.6.2`; those workspace values must not be presented as the 0.2.7 package's output.

Standalone projects use public packages. `workspace:*`, source aliases, and Nimi's internal workspace validation are not a third-party installation path. [App Tools 0.2.7](https://www.npmjs.com/package/@nimiplatform/app-tools/v/0.2.7) is the version addressed above.

## Run Through Nimi Home

The development command asks Desktop, the current Nimi Home host, to launch a supervised Electron App. Use Developer Mode for local project registration and the access required by your App. A visible window does not prove that Runtime access or an AI capability is configured.

No ordinary-user stable Nimi installer is currently published. Check the [official Download page](https://nimi.ai/download) for the actual platform and development-build availability. The Windows Runtime bootstrap is a portable developer component; it does not include Nimi Home, an installer, or the protected product environment needed to stand in for a Home development setup.

If you do not yet have a compatible Home/Runtime development instance, you can prepare the project and its static checks, but supervised launch and capability execution remain unverified until that prerequisite is available. Follow the host's actual errors and [Troubleshooting](/start/troubleshooting); do not launch a renderer directly as an access bypass.

## Add Capabilities And Prepare Distribution

- [First AI Call](/sdk/first-ai-call) explains the request and capability-intent requirements.
- [Use Kit in an App](/platform/kit/use-kit-in-app) covers the generated host binding and shared interfaces.
- [Local development and distribution](/start/#local-development-and-distribution) separates Developer Mode, Registry packages, and immutable local-package imports, including the current platform limits.
- [Web and Nimi Home](/desktop/web-mode) explains the public site and account boundary; the website is not a Desktop web adapter.

Creating or running a project does not publish it or grant Registry admission. Use the actual App Tools release/packaging guidance when you reach that stage.

## Use Nimi Coding Directly

The generated App already declares its required nimicoding dependency, and `pnpm run init` invokes the package's synchronization. This is a real toolchain dependency, not a requirement to first learn Nimi's internal development governance.

If you want to use Nimi Coding's authority tools directly in your own work, read its [overview](/nimicoding/) and [installation guide](/nimicoding/installation).

## Source Basis

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`app-tools/package.json`](https://github.com/nimiplatform/nimi/blob/main/app-tools/package.json)
- [`app-tools/lib/app-scaffold.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-scaffold.mjs)
- [`app-tools/lib/app-doctor-update.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-doctor-update.mjs)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
