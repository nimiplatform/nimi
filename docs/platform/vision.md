# Vision

Nimi starts from a simple belief: your AI should be personal. It should run
where you are, remember what matters to you, and answer to you — not to a
platform that owns it.

That is why Nimi is local-first. It is software you install, and the AI you
talk to runs on your own machine, using models you choose, local or cloud. It
is why your characters and worlds keep their identity no matter where you take
them. And it is why no single part of the system quietly becomes the owner of
everything else: who a character is, how it runs, and how it appears on screen
are separate concerns, each with a clear home.

For users, this adds up to an AI that feels like yours. For builders, it is a
stable set of boundaries to build against.

## Persistent identity, local execution

The character you talk to is a persistent identity kept by Realm — the same
character across every world you visit. When you start a conversation, Runtime
brings that character to life on your machine as a LocalAgent, using the
character description Realm provides. One character can support many local AI
experiences, and each LocalAgent keeps its own running state.

## User-controlled access

Apps ask for things through the SDK in typed form. Runtime works out who you
are, which App is asking, and what it is allowed to do from your active
sign-in session. Apps never hold your Realm credentials, model-provider keys,
or any Runtime-internal proof.

## Interoperable projections

Conversations, memory, knowledge, voice, and presentation all live with
Runtime. Other products receive bounded, typed views of them — nothing more.
Avatar can render a character richly on screen without taking over the
LocalAgent behind it.

## Incremental platform growth

The product loop running today does not depend on general Workflow, MCP, World
Evolution, marketplace, public distribution, or commercial settlement. New
capabilities can join later under their own boundaries, without redefining the
core model of characters brought to life as LocalAgents.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
