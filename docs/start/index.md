<!-- nimi-docs: {"authority":["rule.nimi.platform.app-ecosystem.scaffold-web-carrier","rule.nimi.platform.app-ecosystem.mobile-development-entry"],"sources":["app-tools/package.json","app-tools/README.md"]} -->

# Getting Started with Nimi App Development

Choose the entry for the device where your App runs. The current PC Runtime executes AI, while Desktop, Web and Android consume it through their supported carriers. Start with [artifacts and environment](/start/install), then follow the matching guide.

## Choose an App Carrier

| Carrier | Guide | Current scope |
| --- | --- | --- |
| Desktop | [Create a native App](/start/create-an-app) | Desktop-supervised native Host with matching released or source packages |
| Web | [Connect a website](/start/connect-web-app) | Source delivery: HTTPS source, official login, and direct primary Runtime access |
| Android | [Connect an existing App](/start/connect-android-app) | Source delivery: Kit Capacitor; development Scheme and distributed App Link verified separately |

---

## 4 Steps to Your First Native App

1. **[Development Setup](/start/install)**: Install Node.js and pnpm, and launch the Nimi Desktop supervisor alongside the local Runtime daemon.
2. **[Create an App](/start/create-an-app)**: Use the `@nimiplatform/app-tools` CLI to scaffold a project with protected host access and frontend hot reload.
3. **[Make Your First AI Call](/sdk/first-ai-call)**: Request text completions, streaming responses, or multimodal inference via the strongly-typed Nimi SDK—without managing API keys or low-level RPC endpoints.
4. **[Troubleshooting & Diagnostics](/start/troubleshooting)**: Pinpoint and resolve service disconnections, permission mismatches, or missing model configurations.

> **Going Further**:
> - Need consistent UI components and design tokens? See [Use Kit in an App](/platform/kit/use-kit-in-app).
> - Want an interactive playground to test capability routes? Explore [Nimi Lab](/start/use-nimi-lab).

---

## Native App Lifecycle Modes {#three-app-lifecycle-modes}

Native package and local-development paths have three distinct lifecycle modes:

- **Developer Mode**: Run live, unbundled source code directly under Nimi Desktop supervision, with instant frontend hot-reloading and interactive inspection.
- **Local Package Import**: Import an immutable packaged archive into Nimi Desktop for local verification (implemented on macOS arm64 and Windows x86_64). Local import lets you verify packaged builds on your machine, while full product acceptance and public release readiness are evaluated separately.
- **Official Registry Catalog**: Submit an audited application package to the Nimi Registry so users can discover, install, and update it in Nimi Home. Publishers remain responsible for signing their packages; Registry review governs catalog admission and does not replace an OS signature or serve as a safety guarantee.

*Note: In the current release, package management is supported on macOS (arm64) and Windows (x86_64); package lifecycles on other platforms and ordinary App repair are not yet available. Before submitting for distribution, consult the [App Tools Release Guide](https://github.com/nimiplatform/nimi/tree/main/app-tools#canonical-release-boundary).*

---

## Architecture & API References

- **[SDK Reference](/sdk/)** & **[SDK Boundaries](/sdk/boundaries)**: Public API surface, client conventions, and boundary rules.
- **[Runtime Architecture](/runtime/)**: Model execution, session lifecycles, and protected access.
- **[Platform Architecture](/platform/)** & **[Glossary](/reference/glossary)**: Core platform concepts and authoritative definitions.

Looking to install and experience the Nimi desktop client directly? Visit [nimi.ai](https://nimi.ai) and check the [download page](https://nimi.ai/download).

---

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
