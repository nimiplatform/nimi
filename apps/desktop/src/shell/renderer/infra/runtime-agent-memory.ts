import {
  createNimiHostRuntimeAgentMemorySurface,
  type NimiHostRuntimeAgentMemoryClient,
  type NimiHostRuntimeAgentMemorySurfaceOptions,
  type NimiRuntimeAgentCanonicalMemoryBankStatus,
} from '@nimiplatform/sdk/runtime';
import {
  getDesktopAppId,
  getDesktopRuntime,
} from './sdk/desktop-nimi-client-session';

export type CanonicalMemoryBankStatus = NimiRuntimeAgentCanonicalMemoryBankStatus;

type RuntimeAgentMemoryDeps = {
  getRuntime?: () => NimiHostRuntimeAgentMemoryClient;
  getSubjectUserId?: NimiHostRuntimeAgentMemorySurfaceOptions['getSubjectUserId'];
};

function getDesktopRuntimeAgentMemoryClient(): NimiHostRuntimeAgentMemoryClient {
  return {
    appId: getDesktopAppId(),
    agent: getDesktopRuntime().agents,
  };
}

export function createRuntimeAgentMemoryAdapter(deps: RuntimeAgentMemoryDeps = {}) {
  return createNimiHostRuntimeAgentMemorySurface({
    getRuntime: deps.getRuntime ?? getDesktopRuntimeAgentMemoryClient,
    getSubjectUserId: deps.getSubjectUserId ?? (() => undefined),
  });
}
