// RL-FEAT-007 — Agent selector UI
// RL-CORE-001 — No agent selected → show selection prompt

import { useEffect, useState } from 'react';
import { useAgentProfile } from '../hooks/use-agent-profile.js';
import type { Agent } from '../../../app-shell/providers/app-store.js';
import { AgentCard } from './agent-card.js';

export function AgentSelector() {
  const { currentAgent, fetchAgentList, selectAgent } = useAgentProfile();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [manualId, setManualId] = useState('');

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

  const handleManualSelect = () => {
    const id = manualId.trim();
    if (!id) return;
    selectAgent({ id, name: id });
    setManualId('');
  };

  if (currentAgent) {
    return (
      <div className="p-3 border-b border-gray-800">
        <AgentCard agent={currentAgent} selected />
        <button
          onClick={() => selectAgent(null)}
          className="mt-2 text-xs text-gray-500 hover:text-gray-300"
        >
          Switch agent
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        Loading agents...
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-sm font-medium text-gray-300">Select an Agent</h2>

      {/* Agent list from Realm */}
      {agents.length > 0 && (
        <div className="space-y-1">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => selectAgent(agent)}
              className="w-full text-left"
            >
              <AgentCard agent={agent} />
            </button>
          ))}
        </div>
      )}

      {/* Manual ID entry fallback (when Realm is unreachable) */}
      {fetchError && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Realm unreachable. Enter an agent ID manually:
          </p>
          <div className="flex gap-1">
            <input
              type="text"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSelect()}
              placeholder="agent-id"
              className="flex-1 bg-gray-800 text-white rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={handleManualSelect}
              disabled={!manualId.trim()}
              className="px-2 py-1 bg-blue-600 text-white rounded text-xs disabled:opacity-50"
            >
              Go
            </button>
          </div>
        </div>
      )}

      {!fetchError && agents.length === 0 && (
        <p className="text-xs text-gray-500">No agents available</p>
      )}
    </div>
  );
}
