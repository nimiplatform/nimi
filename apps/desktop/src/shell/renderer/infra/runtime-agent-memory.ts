import {
  createNimiHostRuntimeAgentMemorySurface,
  type NimiHostRuntimeAgentMemoryClient,
  type NimiHostRuntimeAgentMemorySurfaceOptions,
  type NimiRuntimeAgentCanonicalMemoryBankStatus,
} from '@nimiplatform/sdk/runtime';
import {
  getDesktopAccountRuntime,
  getDesktopAppId,
  getDesktopRuntime,
  withDesktopRuntimeProtectedScopes,
} from './sdk/desktop-nimi-client-session';

export type CanonicalMemoryBankStatus = NimiRuntimeAgentCanonicalMemoryBankStatus;

type RuntimeAgentMemoryDeps = {
  getRuntime?: () => NimiHostRuntimeAgentMemoryClient;
  getSubjectUserId?: NimiHostRuntimeAgentMemorySurfaceOptions['getSubjectUserId'];
};

function getDesktopRuntimeAgentMemoryClient(): NimiHostRuntimeAgentMemoryClient {
  const accountRuntime = getDesktopAccountRuntime();
  return {
    appId: getDesktopAppId(),
    auth: accountRuntime.auth,
    appAuth: accountRuntime.grants,
    agent: getDesktopRuntime().agents,
  };
}

export function createRuntimeAgentMemoryAdapter(deps: RuntimeAgentMemoryDeps = {}) {
  return createNimiHostRuntimeAgentMemorySurface({
    getRuntime: deps.getRuntime ?? getDesktopRuntimeAgentMemoryClient,
    getSubjectUserId: deps.getSubjectUserId ?? (() => undefined),
    ...(deps.getRuntime ? {} : { withScopes: withDesktopRuntimeProtectedScopes }),
  });
}
