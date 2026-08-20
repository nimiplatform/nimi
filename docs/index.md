# Nimi Documentation

Nimi is an AI open world platform. It treats Characters as durable
participants in long-lived worlds, not as stateless tools trapped inside one
request. Runtime materializes those Characters as LocalAgents for execution.

These docs explain the product model, the ownership boundaries, and the
contracts that hold across domains.

## How The Docs Are Organized

Nimi is one open world platform. The platform contains several products
that together make Characters able to live in long-lived worlds: Platform
(the world model itself), Runtime (AI execution), SDK (app access),
Desktop and Web (user surfaces), Realm (world truth), Avatar (embodied
presentation), and Nimi Coding (the canonical-authority tooling used by
the repository).

Each product has its own section in these docs.

The active `apps/` directory contains first-party product surfaces and
reference apps. Those apps consume Runtime, Realm, SDK, Kit, and app-tools; they
do not define platform authority. Platform authority lives under `.nimi/spec/**`
and app-authoring entry points are documented from public package surfaces.

## What You Will Find Here

- A product model that explains why Nimi is built around worlds, not chats.
- Authority domains that name who owns which kind of truth.
- Reading paths that move from the platform model into Runtime, SDK,
  Desktop, Realm, Avatar, and Nimi Coding.
- Developer paths for creating a Nimi App, making a first Runtime-backed AI
  call, using Kit, working with Nimi Lab, and handling common fail-closed states.
- A glossary of cross-domain vocabulary used across all pages.

## The Three Layers Readers Should Keep Separate

The platform splits into three layers that are easier to keep distinct in
your head than to mix together.

```
+----------------------------------------------------------+
|  Platform Model                                          |
|    World, Character, and the six protocol primitives     |
+----------------------------------------------------------+
                          |
                          v
+----------------------------------------------------------+
|  Execution Substrate                                     |
|    Runtime    : providers, LocalAgent, Conversation,     |
|                 Memory, Knowledge, streaming, multimodal |
+----------------------------------------------------------+
                          |
                          v
+----------------------------------------------------------+
|  Public Surfaces                                         |
|    SDK app boundary           Desktop native shell       |
|    Web constrained projection Realm public read path     |
|    Avatar embodiment presentation                        |
+----------------------------------------------------------+
```

1. **Platform model** defines worlds, Characters, the six fixed protocol
   primitives, and the rules that say who is allowed to redefine what.
2. **Execution substrate** is how AI work actually happens: Runtime owns
   provider routing, LocalAgent materialization, Conversation, operational
   Memory and Knowledge, streaming, and multimodal output.
3. **Public surfaces** turn the platform into Desktop, Web, SDK, Realm,
   and Avatar experiences. Each public surface has its own authority
   boundary and its own page in these docs.

## Recommended Reading Paths

| If you want to understand... | Start here |
| --- | --- |
| The product, the world model, and why it exists | [Platform](/platform/) |
| The current setup and availability posture | [Start](/start/) |
| How to create a Nimi App scaffold | [Create A Nimi App](/start/create-an-app) |
| How a TypeScript app makes its first Runtime AI call | [First AI Call](/sdk/first-ai-call) |
| How apps reuse Kit surfaces | [Use Kit In An App](/platform/kit/use-kit-in-app) |
| How to work with the capability lab | [Use Nimi Lab](/start/use-nimi-lab) |
| How to interpret Runtime, SDK, Nimi Lab, and scaffold failures | [Troubleshooting](/start/troubleshooting) |
| How AI execution is governed | [Runtime](/runtime/) |
| How apps integrate without crossing private boundaries | [SDK](/sdk/) |
| Why Desktop and Web are not equivalent | [Desktop](/desktop/) |
| Where world truth and history live | [Realm](/realm/) |
| How embodied AI presentation is scoped | [Avatar](/avatar/) |
| Where LocalAgent Memory and Knowledge live | [Runtime Memory And Knowledge](/runtime/memory-and-knowledge) |
| The canonical-authority tooling and its host-agnostic package | [Nimi Coding](/nimicoding/) |
| The cross-domain vocabulary used in these pages | [Glossary](/reference/glossary) |

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
