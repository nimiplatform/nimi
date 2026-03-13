import type { Agent } from '../../../app-shell/providers/app-store.js';

interface AgentCardProps {
  agent: Agent;
  selected?: boolean;
}

export function AgentCard({ agent, selected }: AgentCardProps) {
  return (
    <div
      className={`flex items-center gap-3 p-2 rounded-lg ${
        selected ? 'bg-gray-800' : 'hover:bg-gray-800/50'
      }`}
    >
      <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-medium text-gray-300">
        {agent.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white truncate">{agent.name}</div>
        {agent.description && (
          <div className="text-xs text-gray-500 truncate">{agent.description}</div>
        )}
      </div>
    </div>
  );
}
