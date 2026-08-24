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

1. **Target rail.** You select a Character/LocalAgent as the chat target.
   The conversation shell resolves the `ConversationAnchor` for
   `(local_agent_id, conversation_id)`.
2. **Compose.** You type. The composer shows typed input shape.
3. **Send.** The turn is submitted. Runtime's `RuntimeAgentService`
   accepts it for the selected LocalAgent and Conversation.
4. **Stream begins.** The assistant bubble shows incremental
   content as Mode A chunks arrive.
5. **Mid-stream stop.** You decide to stop early. The streaming
   contract preserves the partial reply.

The Character's durable identity is Realm truth; LocalAgent execution,
Conversation continuity, and transcript are Runtime-owned. An agent
conversation does not create a Realm human-chat thread.

## What Desktop Chat Does Not Do

| Concern | Owned by |
| --- | --- |
| Embodiment / avatar visuals | Avatar app — Desktop chat is no longer a Live2D / VRM carrier |
| Memory authority | Runtime LocalAgent Memory |
| Direct human thread truth | Realm chat |
| Turn execution authority | Runtime agent service |
| Streaming semantics | Runtime streaming contract |

If the user wants embodiment, they go to Avatar. Desktop chat may
show non-carrier presentation projection (e.g., expression
indicator) but the chat surface is no longer the Live2D/VRM
carrier.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
