# Agent Conversation Actions

Desktop Agent Chat renders Runtime's canonical Conversation. Each LocalAgent has one Conversation shared by its authorized consumers; opening another App or window continues that same history.

## Current Actions

- Open the authorized Conversation and read its committed snapshot.
- Send a new user message through the canonical Conversation operation.
- Request interruption of the active turn and display its actual outcome.
- Consume the admitted attachment, artifact, and voice operations when the surface and its current access support them.

The current Agent Conversation contract has no regenerate, prior-message edit, or fork operation. A general-purpose chat component's controls do not grant those operations to Agent Chat. Sending a new message is a new turn, not an edit or replay of an earlier one.

## Stop and Recover

Live text deltas are temporary presentation. When Runtime records an interruption, Desktop clears that turn's uncommitted stream text. Messages already committed remain in the canonical history; for example, text committed before a later associated action is interrupted is not erased by Stop.

After a disconnect or reopen, recover from Runtime's committed snapshot. Do not promote a cached partial reply into a committed message or create a second transcript to preserve it. Keep the Runtime-issued anchor as the operation's revalidated continuity fence.

## Keep Product Flows Separate

Human chat history belongs to Realm. Independent App business work uses its own admitted Agent work operations and project state. Neither path supplies a hidden fork or message-rewrite API for the LocalAgent Conversation.

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform-conversation.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-conversation.ts)
