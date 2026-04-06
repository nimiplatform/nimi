// RL-FEAT-007 — Agent Profile & Selection
// RL-CORE-001 — Selected Agent Drives All Surfaces
// RL-CORE-003 — Agent Resolution at Bootstrap

import { useCallback } from 'react';
import { getBridge } from '../../../bridge/electron-bridge.js';
import { useAppStore, type Agent } from '../../../app-shell/providers/app-store.js';

export function useAgentProfile() {
  const currentAgent = useAppStore((s) => s.currentAgent);
  const setAgent = useAppStore((s) => s.setAgent);

  const fetchAgentList = useCallback(async (): Promise<Agent[]> => {
    const bridge = getBridge();
    const response = await bridge.agent.list();
    return response.items
      .filter((a) => a.state === 'ACTIVE')
      .map((a) => ({
        id: a.agentId,
        name: a.displayName,
        handle: a.handle,
        state: a.state,
        avatarUrl: a.avatarUrl ?? undefined,
      }));
  }, []);

  const selectAgent = useCallback((agent: Agent | null) => {
    // RL-CORE-002: changing agent resets all active sessions
    setAgent(agent);

    // Async enrichment: fetch full profile for voice/live2d support
    if (agent) {
      const bridge = getBridge();
      bridge.agent.get(agent.id).then((profile) => {
        const enriched: Agent = {
          ...agent,
          name: profile.displayName || agent.name,
          handle: profile.handle ?? agent.handle,
          avatarUrl: profile.avatarUrl ?? agent.avatarUrl,
          description: profile.bio ?? agent.description,
        };
        useAppStore.getState().setAgent(enriched);
      }).catch(() => {
        // Enrichment is best-effort; agent remains usable with list data
      });
    }
  }, [setAgent]);

  return {
    currentAgent,
    fetchAgentList,
    selectAgent,
  };
}
