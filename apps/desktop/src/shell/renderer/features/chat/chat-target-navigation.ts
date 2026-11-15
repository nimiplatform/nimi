import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import type { HomeNavigation } from '../../app-shell/providers/home-navigation.js';

/** Only the latest avatar click may commit its resolved Conversation. */
export function createChatTargetNavigation(input: {
  navigation: HomeNavigation;
  openHuman: (accountId: string) => Promise<string>;
  onError: (error: unknown) => void;
}) {
  let request = 0;
  let disposed = false;
  return {
    dispose() { disposed = true; request += 1; },
    async select(target: ConversationTargetSummary) {
      const token = ++request;
      if (disposed) return;
      if (target.source === 'agent') { input.onError(new Error('Partner conversations open in Zhiyu.')); return; }
      if (target.source === 'ai' || (target.source === 'human' && target.canonicalSessionId)) {
        await input.navigation.push({ id: target.source === 'human' ? 'friends' : 'chat', chat: { mode: target.source, targetId: target.id,
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
          if (current()) await input.navigation.push({ id: 'friends', chat: { mode: 'human', targetId: target.id, threadId } });
          return;
        }

      } catch (error) { if (current()) input.onError(error); }
      finally { unsubscribe(); }
    },
  };
}
