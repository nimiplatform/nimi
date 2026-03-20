// RL-BOOT-002 — Renderer Bootstrap
// RL-CORE-003 — Agent Resolution at Bootstrap

import { getBridge } from '../bridge/electron-bridge.js';
import { useAppStore, type Agent, type UserProfile } from '../app-shell/providers/app-store.js';

const BOOTSTRAP_TIMEOUT_MS = 15_000;
const CONFIG_RETRY_ATTEMPTS = 10;
const CONFIG_RETRY_DELAY_MS = 100;
let realtimeStatusSubscribed = false;

export interface BootstrapResult {
  runtimeAvailable: boolean;
  agentId: string | null;
}

export async function bootstrap(): Promise<BootstrapResult> {
  const bridge = getBridge();
  ensureRealtimeStatusSubscription();
  return syncAuthenticatedRendererState(bridge);
}

export async function syncAuthenticatedRendererState(
  bridgeInput?: ReturnType<typeof getBridge>,
): Promise<BootstrapResult> {
  const bridge = bridgeInput ?? getBridge();
  const store = useAppStore.getState();

  const [runtimeAvailable] = await Promise.all([
    probeRuntimeAvailability(bridge),
    loadCurrentUser(bridge).then((user) => store.setCurrentUser(user)),
  ]);
  store.setRuntimeAvailable(runtimeAvailable);

  const agentId = await resolveConfiguredAgent(bridge);
  return { runtimeAvailable, agentId };
}

function ensureRealtimeStatusSubscription(): void {
  if (realtimeStatusSubscribed) {
    return;
  }

  const bridge = getBridge();
  bridge.realtime.onStatus((status) => {
    useAppStore.getState().setRealtimeConnected(status.connected);
  });
  realtimeStatusSubscribed = true;
}

async function probeRuntimeAvailability(
  bridge: ReturnType<typeof getBridge>,
): Promise<boolean> {
  try {
    const healthPromise = bridge.health();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Health check timeout')), BOOTSTRAP_TIMEOUT_MS),
    );
    await Promise.race([healthPromise, timeoutPromise]);
    return true;
  } catch (err) {
    // RL-BOOT-004: Runtime unavailable — degrade gracefully.
    // Auth errors are detected and handled in the main process (before IPC serialization),
    // which pushes auth state to renderer via relay:auth:status event.
    console.warn('[relay:bootstrap] runtime probe failed', err);
    return false;
  }
}

async function resolveConfiguredAgent(
  bridge: ReturnType<typeof getBridge>,
): Promise<string | null> {
  const store = useAppStore.getState();

  for (let attempt = 0; attempt < CONFIG_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const config = await bridge.config();
      if (!config.agentId) {
        store.setAgent(null);
        return null;
      }

      const agent = await fetchAgentProfile(config.agentId, bridge);
      store.setAgent(agent);
      return config.agentId;
    } catch (err) {
      console.warn(`[relay:bootstrap] resolveConfiguredAgent attempt ${attempt + 1}/${CONFIG_RETRY_ATTEMPTS} failed`, err);
      const currentAgentId = useAppStore.getState().currentAgent?.id ?? null;
      const shouldRetry = !currentAgentId && attempt < CONFIG_RETRY_ATTEMPTS - 1;
      if (!shouldRetry) {
        // Config unavailable — preserve any existing agent selection rather than
        // clearing UI state on a transient IPC/authenticated-handler race.
        return currentAgentId;
      }
      await delay(CONFIG_RETRY_DELAY_MS);
    }
  }

  return useAppStore.getState().currentAgent?.id ?? null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readAgentVoiceId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as { voice?: { voiceId?: string } | null };
  return record.voice?.voiceId;
}

/**
 * Fetch current authenticated user profile via bridge.
 * Falls back to null if unavailable (non-blocking).
 */
async function loadCurrentUser(
  bridge: ReturnType<typeof getBridge>,
): Promise<UserProfile | null> {
  try {
    const data = await bridge.auth.currentUser();
    if (!data?.id || !data.displayName) return null;
    return {
      id: String(data.id),
      displayName: String(data.displayName),
      avatarUrl: data.avatarUrl ? String(data.avatarUrl) : undefined,
      email: data.email ? String(data.email) : undefined,
      handle: data.handle ? String(data.handle) : undefined,
    };
  } catch (err) {
    console.warn('[relay:bootstrap] loadCurrentUser failed', err);
    return null;
  }
}

/**
 * Fetch agent profile from Realm via direct account lookup.
 * Contract violations and Realm unavailability are surfaced to the caller.
 */
async function fetchAgentProfile(
  agentId: string,
  bridge: ReturnType<typeof getBridge>,
): Promise<Agent> {
  const profile = await bridge.agent.get(agentId);
  return {
    id: profile.id,
    name: profile.displayName,
    handle: profile.handle,
    state: profile.agent?.state,
    avatarUrl: profile.avatarUrl ?? undefined,
    description: profile.bio ?? undefined,
    voiceId: readAgentVoiceId(profile.agentProfile?.dna),
  };
}
