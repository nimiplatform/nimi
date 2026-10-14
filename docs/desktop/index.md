# Nimi Home Desktop Workspace

Nimi Home is the desktop workspace for the Nimi personal AI platform. It brings human-agent conversations, digital characters, creative projects, virtual worlds, and personal desktop apps into a single hub on your machine—letting you organize your work and choose between local and cloud AI.

Across the platform architecture:
- **Runtime** manages local GPU inference, cloud connectors, and protected credential storage.
- **Realm** maintains ecosystem identity, social graphs, and persistent world state.
- **Nimi Home** is your workspace entry point, hosted by Desktop, which also supervises running App processes.

---

## Core Functional Zones

1. **Home & Activity Hub**
   - Pick up recent conversations, active tasks, and creative drafts right where you left off.
   - Check local service health, hardware acceleration readiness, and pending reminders.
   - Follow activity feeds from friends and verified AI personas.
2. **Characters & Worlds**
   - Talk with AI personas that carry persistent memory and distinct conversational styles.
   - Explore digital worlds crafted by creators across the ecosystem.
3. **Apps & Developer Mode**
   - **App Library**: Launch and organize installed official and third-party desktop apps.
   - **Local Import**: Load an explicitly selected immutable `.nimiapp` package directly from disk without Registry admission (any online features inside the app still require network access).
   - **Developer Mode**: Register local project workspaces, debug capability permissions, and develop with instant hot reload.
4. **AI Capability & Compute Settings**
   - Manage local model weights and their inference engines on your machine.
   - Assign default execution strategies (`Loadouts`) to capabilities like text generation, voice synthesis, or vision, or connect third-party cloud providers.

---

## Running & Developing Nimi Apps

Nimi Home combines process isolation with straightforward local tooling for desktop apps:

- **Supervised Electron Shell**: Apps run inside an isolated host supervised by Desktop. Communication bridges are injected automatically, so frontend code never needs hardcoded API keys or raw gRPC ports.
- **Three Lifecycle Modes**:
  1. **Developer Mode**: Live local development with hot reload and loopback CDP inspection.
  2. **Local Import**: Local verification using an explicitly selected immutable `.nimiapp` package.
  3. **Official Registry**: Public catalog distribution after Registry admission. Publishers are responsible for package signing, though unsigned packages may also be admitted when permitted by policy.
- **Supported Platforms**: Desktop app execution and lifecycle management currently support **Windows (x86_64)** and **macOS (arm64)**. Local import is implemented on both targets, while end-to-end product acceptance and public release readiness are tracked separately. Package lifecycles on other platforms, and ordinary repair on any platform, remain unavailable.

---

## Navigation & Next Steps

- [Create a Nimi App](/start/create-an-app) — Scaffold and launch your first project
- [Make Your First AI Call](/sdk/first-ai-call) — Call local or cloud models in a few lines of code
- [Local AI & Loadout Configuration](/desktop/local-ai) — Manage on-device models and hardware dispatch
- [Conversation Modes & History](/desktop/chat) — Understand agent dialogue and streaming controls

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
