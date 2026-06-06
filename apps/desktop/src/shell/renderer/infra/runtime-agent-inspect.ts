import {
  createNimiHostRuntimeAgentInspectSurface,
  type NimiHostRuntimeAgentInspectClient,
  type NimiRuntimeAgentInspectSurface,
} from '@nimiplatform/sdk/runtime';
import {
  getDesktopAccountRuntime,
  getDesktopAppId,
  getDesktopRuntime,
} from './sdk/desktop-nimi-client-session';

export type {
  NimiRuntimeAgentCanonicalMemoryInspect,
  NimiRuntimeAgentInspectEventSummary,
  NimiRuntimeAgentPendingHookInspect,
  NimiRuntimeAgentInspectSnapshot,
  NimiRuntimeAgentAutonomySnapshot,
  NimiRuntimeAgentStateSnapshot,
} from '@nimiplatform/sdk/runtime';

type RuntimeAgentInspectDeps = {
  getRuntime?: () => NimiHostRuntimeAgentInspectClient;
  getSubjectUserId?: () => string | undefined | Promise<string | undefined>;
};

function getDesktopRuntimeAgentInspectClient(): NimiHostRuntimeAgentInspectClient {
  const accountRuntime = getDesktopAccountRuntime();
  return {
    appId: getDesktopAppId(),
    auth: accountRuntime.auth,
    appAuth: accountRuntime.grants,
    agent: getDesktopRuntime().agents,
  };
}

export function createRuntimeAgentInspectAdapter(
  deps: RuntimeAgentInspectDeps = {},
): NimiRuntimeAgentInspectSurface {
  return createNimiHostRuntimeAgentInspectSurface({
    getRuntime: deps.getRuntime ?? getDesktopRuntimeAgentInspectClient,
    getSubjectUserId: deps.getSubjectUserId ?? (() => undefined),
  });
}
