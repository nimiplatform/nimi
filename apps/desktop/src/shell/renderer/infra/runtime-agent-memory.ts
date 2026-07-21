import {
  createNimiHostRuntimeAgentMemorySurface,
  type NimiHostRuntimeAgentMemoryClient,
  type NimiHostRuntimeAgentMemorySurfaceOptions,
  type NimiRuntimeAgentCanonicalMemoryBankStatus,
} from '@nimiplatform/sdk/runtime';
import type { NimiRuntimeAgentScopeRunner } from '@nimiplatform/sdk/runtime';

export type CanonicalMemoryBankStatus = NimiRuntimeAgentCanonicalMemoryBankStatus;

type RuntimeAgentMemoryDeps = {
  getRuntime?: () => NimiHostRuntimeAgentMemoryClient;
  getSubjectUserId?: NimiHostRuntimeAgentMemorySurfaceOptions['getSubjectUserId'];
  withScopes?: NimiRuntimeAgentScopeRunner;
};

function runtimeAgentMemoryUnavailable(): never {
  throw new Error('DESKTOP_RUNTIME_AGENT_MEMORY_UNBOUND');
}

export function createRuntimeAgentMemoryAdapter(deps: RuntimeAgentMemoryDeps = {}) {
  return createNimiHostRuntimeAgentMemorySurface({
    getRuntime: deps.getRuntime ?? runtimeAgentMemoryUnavailable,
    getSubjectUserId: deps.getSubjectUserId ?? (() => undefined),
    ...(deps.withScopes ? { withScopes: deps.withScopes } : {}),
  });
}
