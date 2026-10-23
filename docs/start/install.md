# Development Environment Setup

Setting up your Nimi development environment gives you everything you need to build local-first AI applications, manage native host interactions, and test end-to-end user workflows on your own machine.

Always choose the App Tools version that matches your Nimi host and keep the dependency combination it generates. This source checkout declares App Tools 0.13.1, SDK 0.21.0, and Kit/native 0.21.0—note that these versions reflect the current source repository and do not imply those exact versions are published on npm.

---

## 1. Required Toolchain

Ensure your development machine has the following tools installed:

- **Node.js**: Use Node.js 24.22.1 or a newer patch/minor release on the Node 24 LTS line.
- **pnpm**: pnpm 10.34.7 (or compatible pnpm 10.x).
- **C/C++ Build Tools** (optional): If compiling Kit's optional native extensions from source, macOS requires Xcode Command Line Tools, while Windows requires Visual Studio C++ build tools.

Scaffolded app projects include project-local Nimi Coding (0.6.5). Running `pnpm install && pnpm run init` configures it automatically without requiring global binary installations.

---

## 2. Core Dependency Combinations

Nimi's core packages are versioned independently. Use the dependency combination declared by your chosen App Tools version. The current source scaffold declares the following combination (when installing from npm, use the versions declared by your published App Tools package):

| Package | Source Scaffold Version | Role |
| :--- | :--- | :--- |
| `@nimiplatform/sdk` | `^0.21.0` | Client core API, AI inference, and host-bound session integration |
| `@nimiplatform/kit` | `^0.21.0` | Cross-platform UI components, window bridge, and theme contracts |
| `@nimiplatform/app-tools` | `^0.13.0` | App scaffolding, project initialization, and production packaging |
| `@nimiplatform/sdk-adapter-vercel-ai` | `^0.5.0` | (Optional) Adapter for Vercel AI SDK 7 |

> [!NOTE] Local Archives & Overrides
> When developing inside the source repository or working with offline distribution bundles, map dependencies directly to local `.tgz` archives using `pnpm-workspace.yaml` overrides. See [Create a Nimi App](/start/create-an-app) for configuration details.

---

## 3. Local Development in Three Steps

If you are developing from the Nimi source repository, first complete the [repository setup](https://github.com/nimiplatform/nimi/blob/main/ONBOARDING.md), including Go, native build tools, and environment settings. The source Runtime launcher connects to a separately prepared Realm service at `http://127.0.0.1:3002`; these commands do not start Realm. Then keep the following three processes running:

### Step 1: Start the Local Runtime Service
In the root directory of the Nimi repository:
```bash
pnpm dev:runtime
```
This runs the local user-space Runtime supervisor, providing unified local model dispatch, secure credential storage, and session authentication.

### Step 2: Start Nimi Desktop / Home
In a second terminal window:
```bash
pnpm dev:desktop
```
When the desktop window launches, sign in with your Nimi account to open Nimi Home. Open **Settings → Developer** and enable Developer Mode before launching your app. Make sure to also verify that your app's Nimi Access is ready separately.

### Step 3: Launch Your App
In your application project directory:
```bash
pnpm dev
```
Your app will launch inside a Desktop-supervised window and request a protected session with the local Runtime. You can now test AI features, configure routing, and inspect responses.

---

## 4. Troubleshooting and Downloads

- Encountering service connection errors or missing permissions? Visit the [Troubleshooting Guide](/start/troubleshooting).
- Looking for ready-to-run desktop installers for daily use? Visit the [Official Downloads Page](https://nimi.ai/download).

## Next Steps

- [Create a Nimi App](/start/create-an-app)
- [Make Your First AI Call](/sdk/first-ai-call)
- [Configure AI Capability Intents](/sdk/ai-config-surface)

## Source Basis

- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`app-tools/lib/app-dependency-combinations.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-dependency-combinations.mjs)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
