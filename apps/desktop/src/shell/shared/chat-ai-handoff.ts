import type { ChatAiThreadBundle } from './chat-ai-store-types.js';

/** Make a portable copy of one selected text conversation, including its current unsent text. */
export function homeChatHandoff(bundle: ChatAiThreadBundle, draft: string) {
  if (bundle.draft?.attachments.length) return null;
  const messages: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const message of bundle.messages) {
    if ((message.role !== 'user' && message.role !== 'assistant') || message.status !== 'complete'
      || message.content.attachments.length || message.content.toolCalls.length || !message.contentText.trim()) return null;
    messages.push({ role: message.role, text: message.contentText });
  }
  if (!messages.length && !draft.trim()) return null;
  return { format: 'nimi.home-chat.v1', threadId: bundle.thread.id, title: bundle.thread.title, messages, draft };
}

export function encodeHomeChatHandoff(copy: NonNullable<ReturnType<typeof homeChatHandoff>>) {
  const text = JSON.stringify(copy);
  return new TextEncoder().encode(text).byteLength <= 1024 * 1024 ? text : null;
}
