import type { Agent } from '../../../app-shell/providers/app-store.js';

interface AgentCardProps {
  agent: Agent;
  selected?: boolean;
}

export function AgentCard({ agent, selected }: AgentCardProps) {
  return (
    <div
      className={`flex items-center gap-3 p-2 rounded-lg transition-colors duration-150 ${
        selected ? 'bg-bg-elevated' : 'hover:bg-bg-elevated/50'
      }`}
    >
      {agent.avatarUrl ? (
        <img
          src={agent.avatarUrl}
          alt={agent.name}
          className="w-8 h-8 rounded-full object-cover"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center text-[11px] font-medium text-text-secondary">
          {agent.name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text-primary truncate">{agent.name}</div>
        {agent.handle && (
          <div className="text-[11px] text-text-secondary truncate">@{agent.handle}</div>
        )}
      </div>
    </div>
  );
}
