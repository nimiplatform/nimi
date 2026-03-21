import type { ChatMessage, RelayChatTurnSendInput } from './types.js';
import type { MainProcessChatContext } from './main-process-context.js';
import { createLocalChatSession, getSessionById } from '../session-store/index.js';
import { createUlid } from './ulid.js';

export async function ensureWorkingSession(input: {
  selectedSessionId: string;
  viewerId: string;
  selectedTarget: RelayChatTurnSendInput['selectedTarget'];
  chatContext: MainProcessChatContext;
}): Promise<{ id: string }> {
  const existingId = String(input.selectedSessionId || '').trim();
  if (existingId) {
    const existing = await getSessionById(existingId, input.viewerId);
    if (existing) return existing;
  }
  if (!input.selectedTarget) throw new Error('RELAY_NO_TARGET');
  const session = await createLocalChatSession({
    targetId: input.selectedTarget.id,
    viewerId: input.viewerId,
    worldId: input.selectedTarget.worldId,
  });
  input.chatContext.setSelectedSessionId(session.id);
  return session;
}

export function createUserMessage(text: string): ChatMessage {
  return {
    id: `msg_${createUlid()}`,
    role: 'user',
    kind: 'text',
    content: text,
    timestamp: new Date(),
  };
}
