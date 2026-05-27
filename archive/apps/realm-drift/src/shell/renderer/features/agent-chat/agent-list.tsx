import { useTranslation } from 'react-i18next';
import type { WorldAgent } from '../world-browser/world-browser-data.js';

type AgentListProps = {
  agents: WorldAgent[];
  activeAgentId: string | null;
  onSelect: (agent: WorldAgent) => void;
};

export function AgentList({ agents, activeAgentId, onSelect }: AgentListProps) {
  const { t } = useTranslation();

  if (agents.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-neutral-500 text-sm">
        {t('chat.agentEmpty')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 overflow-auto">
      {agents.map((agent) => (
        <button
          key={agent.id}
          onClick={() => onSelect(agent)}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
            activeAgentId === agent.id
              ? 'bg-neutral-700'
              : 'hover:bg-neutral-800'
          }`}
        >
          {/* Avatar */}
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-neutral-700 overflow-hidden">
            {agent.avatarUrl ? (
              <img src={agent.avatarUrl} alt={agent.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">
                {agent.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white truncate">{agent.name}</div>
            {agent.bio && (
              <div className="text-xs text-neutral-400 line-clamp-2">{agent.bio}</div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
