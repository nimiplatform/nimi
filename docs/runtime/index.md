# Runtime

Runtime is an independent local service that turns authorized product intent
into AI execution. Apps use its public capability surface through the SDK; they
do not import Runtime internals or call providers directly.

## What Runtime owns

Runtime owns:

- Local and Cloud AI consumption, implementation selection, resource scheduling,
  Token, Quota, Budget, and credential custody;
- LocalAgent materialization and lifecycle from a Realm-issued Character
  Source;
- LocalAgent Conversation, operational Memory and Knowledge, state, voice,
  events, and presentation projections;
- local process, model, service, stream, and audit behavior;
- App identity and authorization derived from the active protected session;
- bounded bridges to independent Realm and optional external capabilities.

These responsibilities stay with Runtime regardless of whether the consumer is
Nimi Home, Desktop, Avatar, a direct SDK client, or a scaffolded App.

## Ownership Boundaries

Realm owns Character identity, Character Source, World Source, canonical World
data, social truth, and World history. Runtime may consume admitted source
context but cannot redefine it.

Apps and first-party surfaces own their product UI, interaction, and ephemeral
cache. They cannot take over Conversation, Memory, Knowledge, LocalAgent,
provider, credential, session, or authorization truth.

General Workflow, MCP, and World Evolution are not Runtime core prerequisites.
An optional external action capability reports its own unavailable state and
does not block LocalAgent Conversation, Memory, Knowledge, voice, or unrelated
capability execution.

## Read paths

- [Streaming](/runtime/streaming)
- [Multimodal](/runtime/multimodal)
- [Agent Execution](/runtime/agent-execution)
- [Memory And Knowledge](/runtime/memory-and-knowledge)
- [Connectors And Providers](/runtime/connectors-and-providers)
- [Local Models](/runtime/local-models)
- [Account And Session](/runtime/account-and-session)
- [Delegated Capability](/runtime/delegated-capability)
- [Local Audit](/runtime/audit-local)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
