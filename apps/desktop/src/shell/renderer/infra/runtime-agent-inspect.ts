import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createHostRuntimeAgentInspectSurface,
  type RuntimeAgentInspectSurface,
} from '@nimiplatform/sdk/runtime';

export type {
  RuntimeAgentCanonicalMemoryInspect,
  RuntimeAgentInspectEventSummary,
  RuntimeAgentPendingHookInspect,
  RuntimeAgentInspectSnapshot,
  RuntimeAgentAutonomySnapshot,
  RuntimeAgentStateSnapshot,
} from '@nimiplatform/sdk/runtime';

type RuntimeClient = ReturnType<typeof getPlatformClient>['runtime'];

type RuntimeAgentInspectDeps = {
  getRuntime?: () => RuntimeClient;
  getSubjectUserId?: () => string | undefined | Promise<string | undefined>;
};

export function createRuntimeAgentInspectAdapter(
  deps: RuntimeAgentInspectDeps = {},
): RuntimeAgentInspectSurface {
  return createHostRuntimeAgentInspectSurface({
    getRuntime: deps.getRuntime ?? (() => getPlatformClient().runtime),
    getSubjectUserId: deps.getSubjectUserId ?? (() => undefined),
  });
}
