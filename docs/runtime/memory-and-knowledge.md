# Memory And Knowledge

Runtime owns operational Memory and Knowledge for each LocalAgent. It decides
what authorized input may be admitted, recalled, retained, queried, used for
execution, and projected to a consumer.

## Realm source truth and Runtime operational truth

Realm owns PersonaCharacter, WorldCharacter, Character Source, World Source,
canonical World data, and their access rules. Runtime may consume an admitted
Character Source as the identity source for LocalAgent materialization and may
use admitted World Source context for execution.

That source context does not transfer Realm ownership to Runtime. Conversely,
Runtime Memory or Knowledge does not become canonical Realm World state or
history.

## LocalAgent isolation

Multiple LocalAgents materialized from the same Character Source have
independent operational Memory and Knowledge. Shared Character source does not
create implicit shared mutable state.

Conversation transcripts and UI history are projections, not a substitute for
Memory or Knowledge. A consumer cannot reconstruct Runtime truth by replaying
cached messages.

## Authorized access

Before any Memory or Knowledge operation, Runtime derives the account, App
identity, authorization, target LocalAgent or admitted scope, and operation from
the active session.

An authorized consumer receives only the content and metadata admitted for that
account, App, LocalAgent, scope, and operation. Internal prompts, provider
details, credentials, source material, proof, and unrelated LocalAgent data
remain private.

If an operation is blocked, unavailable, pending, or failed, Runtime returns a
typed result without changing Conversation or unrelated owner truth.

## Optional bridges

An independent cognition implementation may be used behind a bounded public
bridge, but it does not take over Runtime LocalAgent Memory, Knowledge,
Conversation, authorization, lifecycle, or execution truth. Its absence does
not block the current Runtime, SDK, Nimi Home, or App path.

## Source Basis

- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
