import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createHostRuntimeAgentMemorySurface,
  type HostRuntimeAgentMemorySurfaceOptions,
  type RuntimeAgentCanonicalMemoryBankStatus,
} from '@nimiplatform/sdk/runtime';
import { getDesktopMemoryEmbeddingConfigService } from '@renderer/app-shell/providers/desktop-memory-embedding-config-service';
import { createDesktopMemoryEmbeddingScopeRef } from '@renderer/app-shell/providers/desktop-memory-embedding-scope';

export type CanonicalMemoryBankStatus = RuntimeAgentCanonicalMemoryBankStatus;

type RuntimeClient = ReturnType<typeof getPlatformClient>['runtime'];
type RuntimeAgentMemoryDeps = {
  getRuntime?: () => RuntimeClient;
  getSubjectUserId?: HostRuntimeAgentMemorySurfaceOptions['getSubjectUserId'];
  getMemoryEmbeddingConfigService?: HostRuntimeAgentMemorySurfaceOptions['getMemoryEmbeddingSurface'];
  getMemoryEmbeddingScopeRef?: HostRuntimeAgentMemorySurfaceOptions['getMemoryEmbeddingScopeRef'];
};

export function createRuntimeAgentMemoryAdapter(deps: RuntimeAgentMemoryDeps = {}) {
  return createHostRuntimeAgentMemorySurface({
    getRuntime: deps.getRuntime ?? (() => getPlatformClient().runtime),
    getSubjectUserId: deps.getSubjectUserId ?? (() => undefined),
    getMemoryEmbeddingSurface: deps.getMemoryEmbeddingConfigService
      ?? (() => getDesktopMemoryEmbeddingConfigService()),
    getMemoryEmbeddingScopeRef: deps.getMemoryEmbeddingScopeRef
      ?? (() => createDesktopMemoryEmbeddingScopeRef()),
  });
}
