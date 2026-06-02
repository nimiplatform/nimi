import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createHostRuntimeAgentMemorySurface,
  type HostRuntimeAgentMemorySurfaceOptions,
  type RuntimeAgentCanonicalMemoryBankStatus,
} from '@nimiplatform/sdk/runtime';

export type CanonicalMemoryBankStatus = RuntimeAgentCanonicalMemoryBankStatus;

type RuntimeClient = ReturnType<typeof getPlatformClient>['runtime'];
type RuntimeAgentMemoryDeps = {
  getRuntime?: () => RuntimeClient;
  getSubjectUserId?: HostRuntimeAgentMemorySurfaceOptions['getSubjectUserId'];
};

export function createRuntimeAgentMemoryAdapter(deps: RuntimeAgentMemoryDeps = {}) {
  return createHostRuntimeAgentMemorySurface({
    getRuntime: deps.getRuntime ?? (() => getPlatformClient().runtime),
    getSubjectUserId: deps.getSubjectUserId ?? (() => undefined),
  });
}
