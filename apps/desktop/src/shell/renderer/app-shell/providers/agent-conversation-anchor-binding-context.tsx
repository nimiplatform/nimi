import { createContext, useContext, type PropsWithChildren } from 'react';

import type { AgentConversationAnchorBindingStore } from './agent-conversation-anchor-binding-storage.js';

const AgentConversationAnchorBindingContext = createContext<AgentConversationAnchorBindingStore | null>(null);

export function AgentConversationAnchorBindingProvider(
  props: PropsWithChildren<{ readonly store: AgentConversationAnchorBindingStore }>,
) {
  return (
    <AgentConversationAnchorBindingContext.Provider value={props.store}>
      {props.children}
    </AgentConversationAnchorBindingContext.Provider>
  );
}

export function useAgentConversationAnchorBindings(): AgentConversationAnchorBindingStore {
  const store = useContext(AgentConversationAnchorBindingContext);
  if (!store) throw new Error('AGENT_CONVERSATION_ANCHOR_BINDING_PROVIDER_MISSING');
  return store;
}
