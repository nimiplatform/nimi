# Agent Conversation Actions

Agent Chat opens the Runtime-maintained Conversation for the selected Agent. Committed turns can be read again from another authorized surface; drafts and pending input belong to the current window.

## Send Text or an Image

Type a message and send it to start a turn. The current composer accepts at most one image attachment per turn, subject to the Agent's configured capabilities. Its file picker and paste handler accept image MIME types only.

To discuss a document or code file here, paste the relevant text into the message. The composer does not upload PDF, Markdown, or source-code files as document attachments.

## Stop and Recover

Agent turns display text updates while generation runs. Use Stop to request interruption. Previously committed messages remain in the Conversation; interruption does not undo completed external actions.

After reconnecting, reload the committed Runtime snapshot. A pending fragment or local cache does not prove that a turn committed. Continue with a new message to correct or refine an earlier response rather than silently rewriting history.

## Separate Conversation Modes

Human messages use Realm threads. Ordinary AI/Nimi Chat has its own request and message-storage path; its controls do not inherit Agent Conversation's streaming and Stop behavior. See [Chat Modes](/desktop/chat).

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx)
- [`sdks/typescript/core/app/local-app-runtime-platform-conversation.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-conversation.ts)
