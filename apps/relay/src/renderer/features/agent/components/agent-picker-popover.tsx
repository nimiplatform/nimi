// Agent picker popover — triggered from sidebar bottom
// Reuses AgentCard + agent profile hook

import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentProfile } from '../hooks/use-agent-profile.js';
import type { Agent } from '../../../app-shell/providers/app-store.js';
import { AgentCard } from './agent-card.js';

interface AgentPickerPopoverProps {
  onClose: () => void;
}

export function AgentPickerPopover({ onClose }: AgentPickerPopoverProps) {
  const { t } = useTranslation();
  const { currentAgent, fetchAgentList, selectAgent } = useAgentProfile();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

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

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleSelect = (agent: Agent) => {
    selectAgent(agent);
    onClose();
  };

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 right-0 mb-2 bg-bg-elevated border border-border-subtle rounded-xl shadow-lg overflow-hidden z-50"
      style={{ maxHeight: 320 }}
    >
      <div className="px-3 py-2 border-b border-border-subtle">
        <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">
          {t('agent.switchAgent')}
        </span>
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
        {loading && (
          <div className="p-3 text-center text-text-secondary text-[12px]">
            {t('agent.loadingAgents')}
          </div>
        )}
        {!loading && agents.length > 0 && (
          <div className="p-1">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => handleSelect(agent)}
                className="w-full text-left"
              >
                <AgentCard agent={agent} selected={currentAgent?.id === agent.id} />
              </button>
            ))}
          </div>
        )}
        {!loading && agents.length === 0 && !fetchError && (
          <div className="p-3 text-center text-text-secondary text-[12px]">
            {t('agent.noAgentsAvailable')}
          </div>
        )}
        {fetchError && (
          <div className="p-3">
            <p className="text-[11px] text-text-secondary">{t('agent.realmUnreachable')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
