# Vision & Architecture Philosophy

Nimi is built on a simple conviction: your personal AI should belong to you. It should run on your device, remember what matters to you, and stay accountable to you rather than a centralized platform.

That is why Nimi is local-first by design:
- You install Nimi on your own machine, where your AI characters run locally and use either local models or the cloud providers you configure (with cloud requests sending only the context required for those calls).
- Characters and digital worlds keep a consistent identity across surfaces.
- Every subsystem has a clear boundary: who a character is (identity), how it thinks and acts (runtime execution), and how it appears on screen (embodiment) are separate responsibilities with distinct owners.

For users, this means a personal AI companion with clear privacy and data boundaries. For developers, it provides a stable foundation with explicit contracts.

## Persistent Identity, Local Execution

Each AI character has a durable identity maintained by Realm across the worlds you visit. When you start an interaction, Runtime—operating independently of Realm—instantiates that character on your device as a LocalAgent from Realm's Character Source. A single character identity can back multiple local experiences, with each LocalAgent managing its own active runtime state on your machine.

## Scoped, Session-Bound Access

Applications call platform capabilities through typed SDK contracts. Instead of relying on broad persistent app grants or first-launch permission popups, access is governed by a protected host session and explicitly admitted SDK operations. Runtime verifies the user, calling app, and operation scope from the active session, and apps never receive Realm credentials, model provider API keys, or internal Runtime tokens.

## Structured Projections & Views

Conversations, speech synthesis, presentation state, and per-agent long-term memory in Cognition (accessed through Runtime) are coordinated by Runtime and its sibling subsystems. Applications receive bounded, structured read-only projections. Avatar renders character expressions, gaze, and motion without taking over the LocalAgent decision loop.

## Incremental Platform Evolution

The core platform loop does not depend on general workflow orchestration, external protocol bridges (MCP), autonomous world evolution, public app marketplaces, or commercial settlement. As new capabilities are introduced within their own bounded contracts, the core invariant remains unchanged: characters are instantiated locally as LocalAgents.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
