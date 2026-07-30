import { useEffect, useMemo, useState } from 'react';
import {
  AgentCenter,
  type AgentCenterI18n,
  type AgentCenterSectionId,
} from '@nimiplatform/kit/features/agent-center';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';

type AgentConversationSettingsContentProps = {
  input: UseAgentConversationPresentationInput;
};

export function AgentConversationSettingsContent({ input }: AgentConversationSettingsContentProps) {
  const [activeSection, setActiveSection] = useState<AgentCenterSectionId>('overview');
  const agentCenterI18n = useMemo<AgentCenterI18n>(() => ({
    t: (key, values) => input.t(key, values) as string,
  }), [input.t]);
  useEffect(() => {
    void input.messages.length;
    void input.runtimeAgentCenterAdapter?.refresh();
  }, [input.activeConversationAnchorId, input.messages.length, input.runtimeAgentCenterAdapter]);
  if (!input.runtimeAgentCenterAdapter) return null;
  return (
    <AgentCenter
      activeSection={activeSection}
      chrome="embedded"
      density="compact"
      i18n={agentCenterI18n}
      onSectionChange={setActiveSection}
      session={input.runtimeAgentCenterAdapter}
    />
  );
}
