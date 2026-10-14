# Nimi Vision

> **让 AI 真正属于你。** / **Make AI truly yours.**

Today, most AI experiences isolate you inside a rented browser tab. Your prompts vanish into distant server farms, context is hard to carry from one tool to another, and your digital life is scattered across closed gardens.

Nimi was born from a simple belief: **your AI should live with you, work for you, and belong to you.**

You install Nimi on your own machine. It unites focused AI applications, persistent characters, shared narrative worlds, and continuity across authorized apps. The device is yours, the model choice is yours, the memory is yours, and the tools you create remain yours.

---

## Two Horizons

### 1. The Foundation: A Local-First Personal AI Workstation
At its core, Nimi is an installable personal AI operating environment. It replaces the single, generic chat window with purpose-built applications tailored for real human tasks:
- **Local Sovereignty**: Supported local models run directly on your hardware without cloud inference charges. Choosing local inference keeps model execution on-device without cutting off the rest of the product—online features and optional cloud inference continue to work through their own dedicated data flows.
- **Fluid Continuity**: Authorized apps attached to the same LocalAgent share its presence and can carry its conversation forward across tools. Sharing a LocalAgent does not grant automatic access to another app’s private work.
- **Freedom of Compute**: Seamlessly switch between efficient on-device small models and heavy cloud reasoning engines. You decide when on-device privacy matters and when raw cloud scale is required.

### 2. The Horizon: An Open World Ecosystem
Looking further ahead, Nimi is building towards long-lived, shared semantic worlds.

In these worlds, people, autonomous characters, specialized applications, and runtime services coexist in a persistent social and semantic fabric. Instead of summoning a stateless model that forgets you the moment a tab closes, you step into worlds that remember history, respect timeflow, and enable genuine creative collaboration.

*Crucially, this open world ecosystem is an experiential dimension inside Nimi—it enriches the personal AI product without diluting its local-first, user-sovereign foundation.*

---

## Core Product Commitments

1. **Local-First Execution**: Keep local inference available and let users choose supported local or cloud routes for each capability.
2. **Tools You Can Use and Build**: Bring focused ecosystem apps and developer tools together—whether you are running available ecosystem apps across supported platforms and releases, or building your own private tools with the SDK.
3. **Private, Contextual Continuity**: Memory lives with the individual LocalAgent on your device, and separate LocalAgents maintain separate memories. When relevant context is recalled for a task, it travels with the model request—including to a cloud provider when a cloud route is selected.
4. **Radical Openness**: The platform core (Runtime, SDK, Kit, Proto) is open source. Every admitted ecosystem app maintains a public repository and clear licensing.

---

## Architectural Harmony

Nimi maintains strict, dignified boundaries between its subsystems:

- **Nimi Home** (currently hosted by Desktop): The calm, cohesive workstation where your daily work and explorations begin.
- **Runtime**: The deterministic local engine orchestrating model execution, conversations, and protected capability access.
- **Realm**: The social and semantic backbone stewarding persistent characters, shared world history, and ecosystem identity.
- **Cognition**: The guardian of long-term memory, ensuring contextual recall without sacrificing privacy.
- **Kit & SDK**: The expressive bridge allowing creators to turn ideas into native Nimi experiences with shared interfaces and components.

---

## Guiding Principles

- **Explicit contracts over hidden magic**: Predictable, declared interfaces beat opaque, speculative guessing.
- **Deterministic safety over loose fallbacks**: When a secure channel or capability cannot be guaranteed, fail clearly and cleanly—never simulate false success.
- **Single source of truth**: Documentation and code reflect canonical product authority, not scattered working notes.
- **Privacy and auditability as defaults**: Security is not an afterthought or an enterprise add-on; it is the prerequisite of personal computing.
