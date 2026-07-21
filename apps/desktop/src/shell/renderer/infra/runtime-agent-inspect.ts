import {
  createNimiHostRuntimeAgentInspectSurface,
  type NimiHostRuntimeAgentInspectClient,
  type NimiRuntimeAgentInspectSurface,
  type NimiRuntimeAgentScopeRunner,
} from '@nimiplatform/sdk/runtime';

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
  withScopes?: NimiRuntimeAgentScopeRunner;
};

function runtimeAgentInspectUnavailable(): never {
  throw new Error('DESKTOP_RUNTIME_AGENT_INSPECT_UNBOUND');
}

export function createRuntimeAgentInspectAdapter(
  deps: RuntimeAgentInspectDeps = {},
): NimiRuntimeAgentInspectSurface {
  return createNimiHostRuntimeAgentInspectSurface({
    getRuntime: deps.getRuntime ?? runtimeAgentInspectUnavailable,
    getSubjectUserId: deps.getSubjectUserId ?? (() => undefined),
    ...(deps.withScopes ? { withScopes: deps.withScopes } : {}),
  });
}
