# Memory and Knowledge

Cognition owns long-term Memory and its lifecycle. Runtime owns LocalAgent identity, Conversation, authorization, context assembly, and the typed bridge that delivers committed events and returns bounded Memory outcomes. Knowledge belongs to Cognition's domain but has no active V1 read, write, or public client path.

## Agent-Private Memory

Each LocalAgent has a separate opaque Memory bank. Sharing a Character Source does not share memories. Realm owns Character and World source truth; Memory cannot rewrite canonical World state or history.

Runtime mediates access before any operation reaches Cognition. Apps do not query a Cognition corpus directly, choose an account-wide bank, or reconstruct memories from a local message cache. Authorized Memory management uses its separately admitted Runtime surface; ordinary Agent conversation access does not grant Memory management.

## Conversation and Recall

Runtime keeps the committed Conversation and may ask Cognition for relevant Memory while planning a turn. Recall is optional: missing readiness, an unavailable index, or no matching memory yields zero optional hits without blocking an otherwise valid turn. This does not permit fabricated recall or a fallback Runtime Memory store.

Cognition alone decides and commits Memory admission, correction, supersession, forgetting, and derived index state. A write is not successful until its owner has durably committed the outcome. See [Cognition](/cognition/) for those operations.

## Memory Enablement and Deletion

Memory enablement belongs to each LocalAgent and is independent of the shared LocalAgent AIConfig. New LocalAgents start enabled; pre-cut existing LocalAgents require explicit enablement. Disabling stops new delivery and Recall at a durable cutoff without deleting existing memories. Re-enabling does not replay the disabled interval or revive pre-cut work.

Delete-all preserves the enabled setting but deletes the Agent's Memory through the owner lifecycle barrier. App access revocation removes that App's access; it does not delete the Agent's Memory. LocalAgent termination and an actually observed canonical account-deletion signal have separate deletion rules. Logout, network failure, and account switch are not account-deletion signals.

## Knowledge V1

There is no generic Knowledge ingestion, search, CLI, or SDK surface in V1. Conversation summaries, immutable Character/World lorebook context, and Cognition source retrieval remain distinct from Knowledge. A missing Knowledge API is not an invitation to use removed wire methods.

## Source Basis

- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
