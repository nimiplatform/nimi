/**
 * Shared Desktop memory-embedding Runtime surface.
 *
 * Desktop does not own memory embedding intent. It composes the SDK protected
 * runtime surface over RuntimeCognitionService for inspect, bind, and cutover.
 * The committed text.embed intent is owned by Runtime Agent AI Config.
 */

import { getDesktopAppId, getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';
import {
  createNimiProtectedHostMemoryEmbeddingRuntimeSurface,
  type NimiProtectedHostMemoryEmbeddingRuntimeClient,
  type NimiMemoryEmbeddingRuntimeSurface,
} from '@nimiplatform/sdk/runtime';

export type DesktopMemoryEmbeddingConfigService = {
  memoryEmbeddingRuntime: NimiMemoryEmbeddingRuntimeSurface;
};

type RuntimeClient = ReturnType<typeof getDesktopRuntime>;

type DesktopMemoryEmbeddingConfigServiceDeps = {
  getRuntime?: () => RuntimeClient;
  getAppId?: () => string;
  getSubjectUserId?: () => string | Promise<string>;
};

async function currentSubjectUserId(): Promise<string> {
  const { useAppStore } = await import('./app-store.js');
  const user = useAppStore.getState().auth.user as Record<string, unknown> | null;
  return String(user?.id || '').trim();
}

function createProtectedMemoryEmbeddingRuntimeClient(
  runtime: RuntimeClient,
  appId: string,
): NimiProtectedHostMemoryEmbeddingRuntimeClient {
  const normalizedAppId = String(appId || '').trim();
  if (!normalizedAppId) {
    throw new Error('Desktop memory embedding service requires a Nimi app id.');
  }
  return {
    appId: normalizedAppId,
    memory: runtime.memory,
    auth: runtime.auth,
    appAuth: runtime.grants,
  };
}

export function createDesktopMemoryEmbeddingConfigService(
  deps: DesktopMemoryEmbeddingConfigServiceDeps = {},
): DesktopMemoryEmbeddingConfigService {
  const getRuntime = deps.getRuntime ?? (() => getDesktopRuntime());
  const getAppId = deps.getAppId ?? (() => getDesktopAppId());
  const getProtectedRuntime = () => createProtectedMemoryEmbeddingRuntimeClient(getRuntime(), getAppId());
  const getSubjectUserId = deps.getSubjectUserId ?? currentSubjectUserId;
  const runtimeSurface = createNimiProtectedHostMemoryEmbeddingRuntimeSurface({
    runtime: getProtectedRuntime,
    getSubjectUserId,
  });
  return {
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
