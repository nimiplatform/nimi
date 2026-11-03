import type { HeroDemo } from './landing-content.js';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/types';

type DemoChat = HeroDemo['chat'];
export function resolveDemoChatTarget(chat: DemoChat, id: string | null) {
  const targetId = id ?? chat.defaultTargetId;
  if (targetId.startsWith('human:'))
    return { mode: 'human' as const, target: chat.people.find((person) => person.id === targetId), targetId };
  const assistant = chat.assistantThreads.find((thread) => thread.id === targetId);
  if (assistant) return { mode: 'ai' as const, target: assistant, targetId };
  return { mode: 'agent' as const, target: chat.agents.find((agent) => agent.id === targetId), targetId };
}

export function materializeChatMessages(chat: DemoChat): Record<string, ConversationCanonicalMessage[]> {
  const now = Date.now();
  return Object.fromEntries(
    [...chat.agents, ...chat.people, ...chat.assistantThreads].map((target) => {
      const { mode } = resolveDemoChatTarget(chat, target.id);
      return [
        target.id,
        target.messages.map((seed) => ({
          id: seed.id,
          sessionId: `demo-${target.id}`,
          targetId: target.id,
          source: mode,
          role: seed.role,
          text: seed.text,
          createdAt: new Date(now - seed.minutesAgo * 60_000).toISOString(),
          status: 'complete' as const,
          kind: 'text' as const,
          senderName: seed.role === 'user' ? chat.userName : mode === 'ai' ? 'Nimi' : target.name,
          senderKind: seed.role === 'user' ? ('human' as const) : mode,
          metadata: { canonicalMessageCommitted: true, canonicalTurnStatus: 'completed' },
          senderAvatarUrl: seed.role === 'user' ? chat.self.avatarUrl : target.avatarUrl,
        })),
      ];
    }),
  );
}
