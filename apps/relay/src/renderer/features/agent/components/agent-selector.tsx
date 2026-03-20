// RL-FEAT-007 — Agent selector UI
// RL-CORE-001 — Always-visible agent list, click to switch

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentProfile } from '../hooks/use-agent-profile.js';
import type { Agent } from '../../../app-shell/providers/app-store.js';
import { AgentCard } from './agent-card.js';

export function AgentSelector() {
  const { t } = useTranslation();
  const { currentAgent, fetchAgentList, selectAgent } = useAgentProfile();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    fetchAgentList()
      .then((list) => {
        setAgents(list);
        setFetchError(false);
      })
      .catch(() => {
        setAgents([]);
        setFetchError(true);
      })
      .finally(() => setLoading(false));
  }, [fetchAgentList]);

  if (loading) {
    return (
      <div className="p-4 text-center text-text-secondary text-[13px]">
        {t('agent.loadingAgents')}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {agents.length > 0 && (
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => selectAgent(agent)}
              className="w-full text-left"
            >
              <AgentCard agent={agent} selected={currentAgent?.id === agent.id} />
            </button>
          ))}
        </div>
      )}

      {fetchError && (
        <div className="p-3 border-t border-border-subtle">
          <p className="text-[11px] text-text-secondary">
            {t('agent.realmUnreachable')}
          </p>
        </div>
      )}

      {!fetchError && agents.length === 0 && (
        <div className="p-4 text-center">
          <p className="text-[12px] text-text-secondary">{t('agent.noAgentsAvailable')}</p>
        </div>
      )}
    </div>
  );
}
