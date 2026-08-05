# AI Last Mile

The current AI last mile is the path from authorized user intent to Runtime
LocalAgent execution and back to a typed product projection.

Runtime owns LocalAgent Conversation, operational Memory and Knowledge, Local
and Cloud AI consumption, implementation selection, execution admission,
budget, credentials, and App authorization. SDK exposes the bounded public access surface. Apps own
their product interaction and rendering, not execution truth.

## Core path

1. A user or App submits typed intent through the SDK.
2. Runtime derives account, App identity, authorization, and LocalAgent access
   from the active session.
3. Runtime evaluates capability intent, authorization, Quota, and Budget, then
   selects an admitted implementation.
4. Runtime validates execution output before committing Conversation or other
   LocalAgent truth.
5. The consumer receives only the authorized typed projection.

Provider calls, raw parser output, credentials, Runtime proof, and private
context do not cross into App-owned state.

## Optional external action

An external action plane may be admitted separately, but it is not part of the
core path above. Its absence or failure must not block ordinary LocalAgent
Conversation, Memory, Knowledge, voice, or ordinary AI execution.

See [Delegated Capability](/runtime/delegated-capability) for that isolated
boundary.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
