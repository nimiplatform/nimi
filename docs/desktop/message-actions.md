# Agent Conversation Actions

Agent Chat opens the Runtime-managed Conversation for your selected Agent. Committed turns sync across any authorized surface, while unsubmitted drafts and pending input stay strictly local to your current window.

## Send Text or an Image

Type a message and send it to start a turn. If the Agent's configured capabilities support image input, you can attach up to one image per turn. Both the file picker and clipboard paste accept image MIME types only.

The composer does not upload PDF, Markdown, or source-code files as document attachments. To discuss a document or code snippet, paste the relevant text directly into your message.

## Stop and Recover

Agent responses stream live text updates as they generate. Click **Stop** at any time to request an interruption. Stopping preserves all previously committed messages in the Conversation and does not undo external actions that have already completed.

If you reconnect after a drop, reload the committed snapshot from Runtime. An unfinished text fragment or local frontend cache does not mean a turn was committed. To correct or refine an earlier reply, simply send a new follow-up message rather than trying to rewrite conversation history.

## Separate Conversation Modes

Human-to-human messages run on Realm threads. Ordinary AI/Nimi Chat uses an independent request and storage path and does not share Agent Conversation's streaming updates or **Stop** control. See [Chat Modes](/desktop/chat) for details.

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx)
- [`sdks/typescript/core/app/local-app-runtime-platform-conversation.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-conversation.ts)
