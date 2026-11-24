import { defineEntry } from '@earendil-works/pi-durable';
import { isJsonObject } from '@nimiplatform/sdk/types';

type HomeMessage = { role: 'user' | 'assistant'; text: string };
export const HomeHistory = defineEntry<{ messages: HomeMessage[] }>('nimi.home-chat-history');

export function parseHomeHandoff(source: unknown) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 1024 * 1024) throw new Error('Choose a Home conversation file up to 1 MiB.');
  let data: unknown;
  try { data = JSON.parse(source); } catch { throw new Error('Choose a conversation saved for Harness in Nimi Home.'); }
  if (!isJsonObject(data) || data.format !== 'nimi.home-chat.v1' || typeof data.threadId !== 'string' || !data.threadId.trim()
    || typeof data.title !== 'string' || !data.title.trim()
    || typeof data.draft !== 'string' || !Array.isArray(data.messages)) throw new Error('Invalid Home conversation file.');
  const messages: HomeMessage[] = data.messages.map(message => {
    if (!isJsonObject(message) || (message.role !== 'user' && message.role !== 'assistant')
      || typeof message.text !== 'string' || !message.text.trim()) throw new Error('Invalid message in Home conversation.');
    return { role: message.role, text: message.text };
  });
  if (!messages.length && !data.draft.trim()) throw new Error('This Home conversation is empty.');
  return { threadId: data.threadId, title: data.title, messages, draft: data.draft };
}
