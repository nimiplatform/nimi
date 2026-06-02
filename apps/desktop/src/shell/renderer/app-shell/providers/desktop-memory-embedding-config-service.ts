/**
 * Shared Desktop memory-embedding Runtime surface.
 *
 * Desktop does not own memory embedding binding intent. It composes SDK
 * protected surfaces over RuntimeCognitionService so durable intent, inspect,
 * bind, and cutover all go through Runtime.
 */

import {
  getPlatformClient,
} from '@nimiplatform/sdk';
import {
  createProtectedHostMemoryEmbeddingConfigSurface,
  createProtectedHostMemoryEmbeddingRuntimeSurface,
  type MemoryEmbeddingRuntimeSurface,
  type MemoryEmbeddingConfigSurface,
} from '@nimiplatform/sdk/runtime';

export type DesktopMemoryEmbeddingConfigService = {
  memoryEmbeddingConfig: MemoryEmbeddingConfigSurface;
  memoryEmbeddingRuntime: MemoryEmbeddingRuntimeSurface;
};

type RuntimeClient = ReturnType<typeof getPlatformClient>['runtime'];

type DesktopMemoryEmbeddingConfigServiceDeps = {
  getRuntime?: () => RuntimeClient;
  getSubjectUserId?: () => string | Promise<string>;
};

async function currentSubjectUserId(): Promise<string> {
  const { useAppStore } = await import('./app-store.js');
  const user = useAppStore.getState().auth.user as Record<string, unknown> | null;
  return String(user?.id || '').trim();
}

export function createDesktopMemoryEmbeddingConfigService(
  deps: DesktopMemoryEmbeddingConfigServiceDeps = {},
): DesktopMemoryEmbeddingConfigService {
  const getRuntime = deps.getRuntime ?? (() => getPlatformClient().runtime);
  const getSubjectUserId = deps.getSubjectUserId ?? currentSubjectUserId;
  const configSurface = createProtectedHostMemoryEmbeddingConfigSurface({
    runtime: getRuntime,
    getSubjectUserId,
  });
  const runtimeSurface = createProtectedHostMemoryEmbeddingRuntimeSurface({
    runtime: getRuntime,
    getSubjectUserId,
  });
  return {
    memoryEmbeddingConfig: configSurface,
    memoryEmbeddingRuntime: runtimeSurface,
  };
}

let singleton: DesktopMemoryEmbeddingConfigService | null = null;

export function getDesktopMemoryEmbeddingConfigService(): DesktopMemoryEmbeddingConfigService {
  if (!singleton) {
    singleton = createDesktopMemoryEmbeddingConfigService();
  }
  return singleton;
}
