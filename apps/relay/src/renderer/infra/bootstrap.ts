// RL-BOOT-002 — Renderer Bootstrap
// RL-CORE-003 — Agent Resolution at Bootstrap

import { getBridge } from '../bridge/electron-bridge.js';
import { useAppStore, type Agent } from '../app-shell/providers/app-store.js';
import { initI18n } from '../i18n/index.js';

const BOOTSTRAP_TIMEOUT_MS = 15_000;

export interface BootstrapResult {
  runtimeAvailable: boolean;
  agentId: string | null;
}

export async function bootstrap(): Promise<BootstrapResult> {
  // Initialize i18n before any UI rendering
  await initI18n();

  const bridge = getBridge();
  const store = useAppStore.getState();

  let runtimeAvailable = false;

  // Step 1: Health check with timeout (RL-BOOT-002, RL-BOOT-004)
  try {
    const healthPromise = bridge.health();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Health check timeout')), BOOTSTRAP_TIMEOUT_MS),
    );
    await Promise.race([healthPromise, timeoutPromise]);
    runtimeAvailable = true;
  } catch {
    // RL-BOOT-004: Runtime unavailable — degrade gracefully
    runtimeAvailable = false;
  }

  store.setRuntimeAvailable(runtimeAvailable);

  // Step 2: Listen for realtime connection status updates
  bridge.realtime.onStatus((data: unknown) => {
    const status = data as { connected: boolean };
    useAppStore.getState().setRealtimeConnected(status.connected);
  });

  // Step 3: Agent resolution (RL-CORE-003)
  // If NIMI_AGENT_ID was provided via env, fetch full profile from Realm
  let agentId: string | null = null;
  try {
    const config = await bridge.config();
    if (config.agentId) {
      agentId = config.agentId;
      // RL-CORE-003: Fetch full agent profile (voiceId, etc.)
      const agent = await fetchAgentProfile(config.agentId);
      store.setAgent(agent);
    }
  } catch {
    // Config unavailable — agent selection handled by UI
  }

  return { runtimeAvailable, agentId };
}

/**
 * Fetch agent profile from Realm via direct account lookup.
 * Falls back to a stub agent if Realm is unreachable (RL-BOOT-004 degradation).
 */
async function fetchAgentProfile(agentId: string): Promise<Agent> {
  const bridge = getBridge();
  try {
    const result = await bridge.realm.request({
      method: 'GET',
      path: `/api/agent/accounts/${encodeURIComponent(agentId)}`,
    });
    const profile = result as {
      id: string;
      displayName: string;
      handle?: string;
      avatarUrl?: string | null;
      bio?: string | null;
      agent?: {
        state?: string;
      };
      agentProfile?: {
        dna?: {
          voice?: { voiceId?: string };
        } | null;
      };
    };
    return {
      id: profile.id,
      name: profile.displayName,
      handle: profile.handle,
      state: profile.agent?.state,
      avatarUrl: profile.avatarUrl ?? undefined,
      description: profile.bio ?? undefined,
      voiceId: profile.agentProfile?.dna?.voice?.voiceId,
    };
  } catch {
    // Realm unreachable — fall back to stub
  }
  // Fallback: stub agent with only ID
  return { id: agentId, name: agentId };
}
