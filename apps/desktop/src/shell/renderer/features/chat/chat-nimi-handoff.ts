import { encodeHomeChatHandoff, type homeChatHandoff } from '../../../shared/chat-ai-handoff.js';

export function saveHomeChatHandoff(copy: NonNullable<ReturnType<typeof homeChatHandoff>>) {
  const text = encodeHomeChatHandoff(copy);
  if (text === null) return false;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = (copy.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 60) || 'conversation') + '.nimi-chat.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
