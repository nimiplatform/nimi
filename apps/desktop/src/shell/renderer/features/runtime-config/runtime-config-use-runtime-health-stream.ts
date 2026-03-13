import { useMemo } from 'react';
import type { RuntimeHealthEvent, AIProviderHealthEvent } from '@nimiplatform/sdk/runtime';
import { useRuntimeHealthCoordinatorState } from './runtime-health-coordinator.js';

export function useRuntimeHealthStream(enabled: boolean): {
  latestHealth: RuntimeHealthEvent | null;
  latestProviderEvents: AIProviderHealthEvent[];
  streaming: boolean;
  streamError: string | null;
} {
  const state = useRuntimeHealthCoordinatorState();

  const latestHealth = useMemo<RuntimeHealthEvent | null>(() => {
    if (!enabled || !state.runtimeHealth) {
      return null;
    }
    return {
      sequence: '0',
      status: state.runtimeHealth.status,
      reason: state.runtimeHealth.reason,
      queueDepth: state.runtimeHealth.queueDepth,
      activeWorkflows: state.runtimeHealth.activeWorkflows,
      activeInferenceJobs: state.runtimeHealth.activeInferenceJobs,
      cpuMilli: state.runtimeHealth.cpuMilli,
      memoryBytes: state.runtimeHealth.memoryBytes,
      vramBytes: state.runtimeHealth.vramBytes,
      sampledAt: state.runtimeHealth.sampledAt,
    };
  }, [enabled, state.runtimeHealth]);

  const latestProviderEvents = useMemo<AIProviderHealthEvent[]>(() => {
    if (!enabled) {
      return [];
    }
    return state.providerHealth.map((provider) => ({
      sequence: '0',
      providerName: provider.providerName,
      state: provider.state,
      reason: provider.reason,
      consecutiveFailures: provider.consecutiveFailures,
      lastChangedAt: provider.lastChangedAt,
      lastCheckedAt: provider.lastCheckedAt,
      subHealth: provider.subHealth,
    }));
  }, [enabled, state.providerHealth]);

  return {
    latestHealth,
    latestProviderEvents,
    streaming: enabled && state.streamConnected && !state.stale,
    streamError: enabled ? state.streamError : null,
  };
}
