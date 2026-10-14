# Conversation Modes & Messaging

Catch up with a friend, ask the assistant a quick question, or pick up an ongoing conversation with an Agent. Nimi Home brings all three together in one place while keeping their histories, storage, and controls separate.

## Choose a Conversation

| Mode | Where the history lives | What to expect |
| --- | --- | --- |
| **Direct messages** | Realm message threads | Human-to-human messaging where membership, delivery, and read state follow Realm rules. |
| **Assistant chat (Nimi Chat)** | This mode’s local message store | Waits for the complete response, then saves the exchange. |
| **Agent dialogue** | Runtime’s `Conversation` for the selected `LocalAgent` | Streams text updates as they arrive and lets you request an interruption with **Stop**. |

## Continue an Agent Dialogue

Select an Agent partner and send text or a supported image. The composer accepts at most one image per turn, and the active capability must support image input.

Clicking **Stop** requests an interruption to the current reply. It keeps all previously committed turns intact and cannot undo external actions that have already completed. When Nimi Home reconnects or reloads, it restores the committed `Conversation` snapshot from Runtime—an unsent draft or an interrupted, unfinished response does not count as a saved turn.

To keep your dialogue continuous, Runtime issues a Conversation anchor. Each `LocalAgent` maintains a single durable `Conversation` across authorized surfaces. The anchor simply links that ongoing conversation; it is not an access credential and does not represent a separate topic, location, or new session.

## Ask the Assistant or Message a Friend

Nimi Chat uses `client.ai.text.generateCandidate` for quick, one-off tasks like proofreading text or explaining code. Because it waits for the full response rather than streaming, it does not include Agent dialogue’s **Stop** button, and reopening its window will not convert a pending request into a committed Agent turn.

Direct messages with friends run on Realm threads. They do not create Agent Conversation anchors or use AI generation controls.

## Your Conversation and Memory

Runtime manages each `LocalAgent`’s `Conversation`, while Cognition manages its optional long-term memory. Every `LocalAgent` keeps its own isolated memory. Keep in mind that local storage only determines where history and memories rest: if you configure a cloud provider for inference, relevant conversation turns and recalled memory context may be sent to that provider to generate a response.

## Next Steps

- [Agent actions](/desktop/message-actions)
- [Voice input and realtime sessions](/desktop/voice-session)
- [Avatar presentation](/desktop/agent-avatar)

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
