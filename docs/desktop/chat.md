# Chat

Chat in Desktop is one surface with three kinds of conversation:
**human**, **AI**, and **agent**. You can message another person,
prompt a general AI assistant, or talk to a specific Nimi agent.
Same window, three conversation shapes.

## Three Host Modes

| Mode | Who you're talking to | Authority |
| --- | --- | --- |
| Human | Another user | Realm chat thread |
| AI | A generic AI assistant | Runtime via SDK |
| Agent | A specific Nimi agent | Runtime + ConversationAnchor |

The mode decides what the chat window shows: the target rail (who
you're talking to), the conversation shell, the transcript, and the
composer.

## Realtime Delivery

Human chat receives Realm-owned realtime updates through the SDK. Nimi Chat
uses the App AI stream, while Agent Chat consumes Runtime's typed Conversation
events and committed snapshots. These paths retain their owners' session,
ordering, terminal, and recovery semantics; they are not one generic message bus.

## Streaming Chat

When you're talking to an AI or an agent, the reply streams in from
Runtime as it's generated.

| Property | Value |
| --- | --- |
| Protocol | Nimi Chat uses the App text stream; Agent Chat uses typed Conversation turn and message events |
| Bubble rendering | Incremental as chunks arrive |
| Mid-stream stop | Available during streaming |
| Agent partial content | Transient until committed; uncommitted text is cleared when interrupted |
| Delivery bounds | Typed backpressure/resource failures; no unlimited buffering or generic replay |

In Agent Chat, Stop requests interruption of the current turn. Live deltas are
not committed history: interrupted turns lose their uncommitted text. Messages
already committed remain, including text committed before an associated action
is interrupted. Recover from the committed snapshot, not a partial UI buffer.

## Turn Lifecycle Ownership

Desktop chat draws the conversation and forwards your intent through
the SDK. Runtime handles the model call, the streaming lifecycle,
ConversationAnchor continuity, and agent track execution. Desktop has
no local surface for intercepting a turn.

## Reader Scenario: Talking To An Agent

You open chat, target your agent, and start typing.

1. **Target rail.** You select a Character/LocalAgent as the chat target.
   The conversation shell uses its current authorized Agent handle to open
   that LocalAgent's single Conversation and retain its returned anchor.
2. **Compose.** You type. The composer shows typed input shape.
3. **Send.** The turn is submitted. Runtime's `RuntimeAgentService`
   accepts it for the selected LocalAgent and Conversation.
4. **Stream begins.** The assistant bubble shows transient text from typed
   Conversation events; a committed message is recorded separately.
5. **Mid-stream stop.** Runtime reports the interruption. Desktop clears the
   uncommitted reply; messages already committed remain in the snapshot.

The Character's durable identity is Realm truth; LocalAgent execution,
Conversation continuity, and transcript are Runtime-owned. An agent
conversation does not create a Realm human-chat thread.

## What Desktop Chat Does Not Do

| Concern | Owned by |
| --- | --- |
| Embodiment / avatar visuals | Avatar app — Desktop chat is no longer a Live2D / VRM carrier |
| Memory authority | Cognition Agent-private Memory, mediated by Runtime |
| Direct human thread truth | Realm chat |
| Turn execution authority | Runtime agent service |
| Streaming semantics | Runtime streaming contract |

If you want embodiment, the Avatar app is the place. Desktop chat can
show small non-carrier cues (like an expression indicator), but the
chat window itself is no longer the Live2D/VRM carrier.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
