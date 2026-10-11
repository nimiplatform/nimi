# Nimi Home and App Development

Nimi Home is the desktop entry for the Nimi personal AI product. It brings conversations, characters, creations, worlds, settings, and Nimi Apps together. Runtime executes local and cloud AI; Realm owns account and ecosystem identity.

## Run Your App Locally

For third-party App development, start with [Create a Nimi App](/start/create-an-app). The supported development command launches your App in a Desktop-supervised Electron host. Opening its renderer URL in a browser does not establish that App session or provide its protected Runtime access.

Local development runs via Developer Mode for rapid debugging under desktop supervision. For packaged delivery, Nimi supports locally imported immutable packages for testing, alongside official Registry-approved catalog distribution. In current pre-releases, desktop app management is available on Windows (x86_64) and macOS (arm64); package lifecycle on other platforms and ordinary repair remain unavailable. See [Local Development and Distribution](/start/#local-development-and-distribution) for details.

## Use the Right Entry

- **Develop an App:** [Create, check, and run a project](/start/create-an-app), then [make your first AI call](/sdk/first-ai-call).
- **Connect AI settings:** use the [Kit App pattern](/platform/kit/use-kit-in-app); keep Runtime access and permission checks in the supported SDK and host path.
- **Find a product download:** check the [current release status](https://nimi.ai/download); no Nimi Home download is published yet. Nimi Home requires a Nimi account, and you sign in through your browser.
- **Understand the website:** [Web and Nimi Home](/desktop/web-mode) explains the public/account website and the separate desktop entry.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
