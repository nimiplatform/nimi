# Vision & Architecture Philosophy

Nimi is built upon a fundamental conviction: your AI should be truly personal. It should run on your personal devices, understand and retain what matters to you, and remain exclusively accountable to you—rather than serving the interests of a centralized cloud platform.

That is why Nimi is local-first by design:
- It is software you install locally; the AI characters you interact with execute on your own machine, utilizing local models or cloud APIs of your choice.
- Your characters and digital worlds maintain identity continuity across any surface.
- The system's subsystems adhere to strict separation of concerns: who a character is (identity), how it executes (runtime reasoning), and how it renders on screen (embodiment) are distinct concerns with clear architectural owners.

For end users, this delivers an AI companion that feels genuinely private and personal. For developers, it provides a stable, predictable foundation with clean boundaries to build upon.

## Persistent Identity, Local Execution

The character you engage with represents a durable identity maintained by Realm—preserving identity across every digital world you visit. When initiating a conversation, Runtime instantiates that character locally as a LocalAgent based on the Character Source provided by Realm. A single character identity can support multiple local AI experiences, with each LocalAgent managing its active runtime state on the user's device.

## Scoped, User-Controlled Access

Applications request capabilities through typed SDK contracts. Runtime validates user identity, calling application identity, and authorized permissions directly from the active authenticated session. Applications never receive Realm credentials, model provider API keys, or internal Runtime tokens.

## Structured Projections & Views

Conversations, memory retrieval, knowledge associations, speech synthesis, and presentation states are managed by Runtime and its sibling subsystems. Applications receive bounded, structured read-only projections. Avatar renders rich character expressions, gaze, and motions without taking over the underlying LocalAgent decision loop.

## Incremental Platform Evolution

The current platform core does not depend on complex general workflows, external protocol bridges (MCP), autonomous world evolution, public app marketplaces, or commercial settlement. Future platform capabilities will integrate cleanly within their own bounded contracts, preserving the foundational invariant of characters instantiated locally as LocalAgents.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
