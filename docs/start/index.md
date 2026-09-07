# Build A Nimi App

Use these guides to build a third-party app for the Nimi ecosystem. Start with a local project, connect the capabilities it needs, and check the separate requirements before distributing it.

## Your First Development Steps

1. [Check the development setup](/start/install). Project creation and static checks need Node.js and pnpm; supervised execution also needs a compatible Nimi Home development instance and Runtime.
2. [Create your App](/start/create-an-app). Install dependencies, initialize the generated project, and run its checks before starting the development host.
3. [Make your first AI call](/sdk/first-ai-call). Understand the App identity, capability intent, access requirements, and typed result. In a generated App, keep the provided SDK/Kit host binding.
4. [Troubleshoot integration](/start/troubleshooting) when a step fails. Check the actual error before changing configuration or retrying.

For shared UI and host integration, read [Use Kit in an App](/platform/kit/use-kit-in-app). For concrete capability examples, see [Nimi Lab](/start/use-nimi-lab).

## Local Development And Distribution

Nimi Apps have three distinct paths: Registry-approved packages, explicitly selected immutable local-package imports, and non-package Developer Mode projects. This guide starts with Developer Mode; creating a project or opening its window does not grant Nimi Access or publish it.

The current pre-release supports protected-tag GitHub Actions and immutable GitHub Release publication for explicitly configured pilot App repositories, protected static Registry onboarding with human-approved descriptors, and verified Catalog discovery, installation, launch/focus/stop, protected-session Access, and uninstall on Windows x86_64. The local-package import entry, other-platform package lifecycle, ordinary update, and repair remain unavailable. Bundled/platform Apps follow their own rules.

Read the [App Tools release guidance](https://github.com/nimiplatform/nimi/tree/main/app-tools#canonical-release-boundary) before preparing distribution. Keep local execution, published assets, Registry admission, installed state, and access as separate results.

## Reference When You Need It

- [SDK](/sdk/) and [SDK boundaries](/sdk/boundaries): public integration interfaces.
- [Runtime](/runtime/): execution, configuration, and failure behavior.
- [Platform](/platform/) and [Glossary](/reference/glossary): product concepts and terminology.
- [Nimi Coding](/nimicoding/): using the authority tooling directly. Generated App initialization already handles its required toolchain integration.

For the personal AI product and ordinary-user download status, visit [nimi.ai](https://nimi.ai) and [Download](https://nimi.ai/download).

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
