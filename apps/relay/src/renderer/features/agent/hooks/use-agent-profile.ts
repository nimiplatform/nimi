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
    const result = await bridge.realm.request({
      method: 'GET',
      path: '/api/agents',
    });
    // Map realm response to Agent shape
    const agents = result as Array<{
      id: string;
      name: string;
      avatar_url?: string;
      description?: string;
      voice_model?: string;
      voice_id?: string;
      live2d_model_url?: string;
    }>;
    return agents.map((a) => ({
      id: a.id,
      name: a.name,
      avatarUrl: a.avatar_url,
      description: a.description,
      voiceModel: a.voice_model,
      voiceId: a.voice_id,
      live2dModelUrl: a.live2d_model_url,
    }));
  }, []);

  const selectAgent = useCallback((agent: Agent | null) => {
    // RL-CORE-002: changing agent resets all active sessions
    setAgent(agent);
  }, [setAgent]);

  return {
    currentAgent,
    fetchAgentList,
    selectAgent,
  };
}
