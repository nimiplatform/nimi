# Chat Modes and Conversation History

Nimi Home offers human messaging, ordinary AI/Nimi Chat, and Agent Conversation in the chat surface. Their request, interruption, and history behavior differs.

| Mode | Execution and storage | Current response behavior |
| --- | --- | --- |
| Human | Realm message threads | Messages and read state synchronize through Realm |
| AI/Nimi Chat | App AI candidate request and this mode's local message storage | Waits for a complete response, then saves the messages |
| Agent | Runtime-managed canonical Conversation | Shows text updates and supports a turn-interruption request |

## Ordinary AI/Nimi Chat

Send a query and wait for the complete result. This path uses `generateCandidate`; it does not provide the Agent mode's token-by-token display or Stop handler. A pending request is not a committed Agent Conversation turn. Do not assume that closing or reopening the window preserves that pending execution as canonical Conversation state.

## Agent Conversation

Select the Agent and open its Runtime Conversation. Send text or a supported image to start a turn. While generation runs, the interface shows updates; Stop requests interruption without deleting previously committed turns.

After a reconnect or refresh, the client reads the committed Runtime snapshot. Local drafts, pending fragments, and the displayed status remain separate from that history.

## Human Messaging

Human messages use Realm threads and their own membership and delivery rules. They do not create Agent Conversation anchors or inherit AI generation controls.

## Related Documentation

- [Agent Actions](/desktop/message-actions)
- [Voice Interaction](/desktop/voice-session)

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/chat/chat-nimi-shell-runtime-adapter.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-nimi-shell-runtime-adapter.ts)
- [`apps/desktop/src/shell/renderer/features/chat/chat-nimi-shell-host-actions.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-nimi-shell-host-actions.ts)
- [`apps/desktop/src/shell/renderer/features/chat/chat-nimi-shell-presentation.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-nimi-shell-presentation.tsx)
