import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import type { HomeNavigation } from '../../app-shell/providers/home-navigation.js';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types.js';

/** Only the latest avatar click may commit its resolved Conversation. */
export function createChatTargetNavigation(input: {
  navigation: HomeNavigation;
  openAgent: (target: ConversationTargetSummary) => Promise<AgentLocalTargetSnapshot | null>;
  openHuman: (accountId: string) => Promise<string>;
  rememberAgent: (target: AgentLocalTargetSnapshot) => void;
  onError: (error: unknown) => void;
}) {
  let request = 0;
  let disposed = false;
  return {
    dispose() { disposed = true; request += 1; },
    async select(target: ConversationTargetSummary) {
      const token = ++request;
      if (disposed) return;
      if (target.source === 'ai' || (target.source === 'human' && target.canonicalSessionId)) {
        await input.navigation.push({ id: 'chat', chat: { mode: target.source, targetId: target.id,
          ...(target.source === 'human' && target.canonicalSessionId ? { threadId: target.canonicalSessionId } : {}) } });
        return;
      }
      const origin = input.navigation.getSnapshot();
      let left = false;
      const current = () => !disposed && !left && token === request
        && input.navigation.getSnapshot().generation === origin.generation
        && input.navigation.getSnapshot().current.key === origin.current.key;
      const unsubscribe = input.navigation.subscribe(() => { if (!current()) left = true; });
      try {
        if (target.source === 'human') {
          const threadId = await input.openHuman(target.id);
          if (current()) await input.navigation.push({ id: 'chat', chat: { mode: 'human', targetId: target.id, threadId } });
          return;
        }
        const agent = await input.openAgent(target);
        if (!current() || !agent?.agentHandle || !agent.conversationAnchorId) return;
        const section = input.navigation.getSnapshot().current.destination.chat?.agentCenterSection;
        input.rememberAgent(agent);
        await input.navigation.push({ id: 'chat', chat: { mode: 'agent', targetId: agent.agentHandle,
          agentHandle: agent.agentHandle, conversationAnchorId: agent.conversationAnchorId,
          ...(section ? { agentCenterSection: section } : {}) } });
      } catch (error) { if (current()) input.onError(error); }
      finally { unsubscribe(); }
    },
  };
}
