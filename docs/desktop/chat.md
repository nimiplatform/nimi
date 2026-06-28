# Chat

Desktop's chat is a unified surface across three host modes:
**human**, **AI**, and **agent**. It is where a user
talks to other people, talks to a generic AI assistant, and talks
to a Nimi agent. Same UI shell, three different conversation
shapes.

## Three Host Modes

| Mode | Who you're talking to | Authority |
| --- | --- | --- |
| Human | Another user | Realm chat thread |
| AI | A generic AI assistant | Runtime via SDK |
| Agent | A specific Nimi agent | Runtime + ConversationAnchor |

The mode determines what the chat shell shows: target rail (who),
canonical conversation shell, transcript, composer.

## Realtime Delivery

Live chat events sync via Socket.IO. New messages, typing
indicators, presence, read state — all delivered as realtime
events rather than polled. The realtime path is admitted; chat
does not invent its own protocol.

## Streaming Chat

When the chat target is AI or agent, the assistant message
streams from Runtime under the streaming contract.

| Property | Value |
| --- | --- |
| Mode | Mode A (text/voice with explicit completed or failed stream event) |
| Bubble rendering | Incremental as chunks arrive |
| Mid-stream stop | Available during streaming |
| Partial content | Preserved on interrupt |
| Backpressure | End-to-end via SDK |

A user who clicks "stop" mid-stream gets the partial reply
preserved; the next interaction starts cleanly.

## Turn Lifecycle Ownership

Desktop chat renders the conversation shell and forwards user intent
through the SDK. Runtime owns the model call, streaming lifecycle,
ConversationAnchor continuity, and agent track execution. Desktop does
not expose a local turn interception surface.

## Reader Scenario: Talking To An Agent

You open chat, target your agent, and start typing.

1. **Target rail.** You select your agent as the chat target.
   The conversation shell resolves the `ConversationAnchor` for
   `(your_agent_id, this_conversation_id)`.
2. **Compose.** You type. The composer shows typed input shape.
3. **Send.** The turn is submitted. Runtime's `RuntimeAgentService`
   accepts the turn under the agent's Chat Track.
4. **Stream begins.** The assistant bubble shows incremental
   content as Mode A chunks arrive.
5. **Mid-stream stop.** You decide to stop early. The streaming
   contract preserves the partial reply.
6. **Realm chat thread.** The turn is recorded in the canonical
   chat thread — Realm `R-CHAT-*`.

The agent's identity is canonical Realm truth; the conversation
continuity is the runtime-owned anchor; the streaming behavior is
admitted contract; the thread is canonical chat history.

## Reader Scenario: Group Chat With An Agent Slot

You are in a Realm group chat with humans and an agent slot.

1. **Group thread.** Realm `R-CHAT-*` admits `GROUP` substrate.
2. **Agent author validation.** When the agent posts, Realm
   validates the agent slot binding. Anti-spoof check happens
   before the message commits.
3. **Members see typed agent author.** Humans cannot impersonate
   the agent; the agent cannot post outside its admitted slot.
4. **Streaming for the agent message.** The agent's reply streams
   into the group thread.

The anti-spoof check is at the protocol level. A malicious actor
who tried to author messages "from" the agent without slot binding
fails closed.

## What Desktop Chat Does Not Do

| Concern | Owned by |
| --- | --- |
| Embodiment / avatar visuals | Avatar app — Desktop chat is no longer a Live2D / VRM carrier |
| Memory authority | Cognition + Runtime memory bank scopes |
| Canonical thread truth | Realm chat |
| Turn execution authority | Runtime agent service |
| Streaming semantics | Runtime streaming contract |

If the user wants embodiment, they go to Avatar. Desktop chat may
show non-carrier presentation projection (e.g., expression
indicator) but the chat surface is no longer the Live2D/VRM
carrier.

## Source Basis

- [`.nimi/spec/desktop/chat.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/chat.md)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
- [`.nimi/spec/desktop/kernel/streaming-consumption-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/streaming-consumption-contract.md)
- [`.nimi/spec/desktop/kernel/conversation-capability-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/conversation-capability-contract.md)
