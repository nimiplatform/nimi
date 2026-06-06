/**
 * Shared Desktop memory-embedding Runtime surface.
 *
 * Desktop does not own memory embedding binding intent. It composes SDK
 * protected surfaces over RuntimeCognitionService so durable intent, inspect,
 * bind, and cutover all go through Runtime.
 */

import { getDesktopAppId, getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';
import {
  createNimiProtectedHostMemoryEmbeddingConfigSurface,
  createNimiProtectedHostMemoryEmbeddingRuntimeSurface,
  type NimiProtectedHostMemoryEmbeddingConfigClient,
  type NimiProtectedHostMemoryEmbeddingRuntimeClient,
  type NimiMemoryEmbeddingRuntimeSurface,
  type NimiMemoryEmbeddingConfigSurface,
} from '@nimiplatform/sdk/runtime';

export type DesktopMemoryEmbeddingConfigService = {
  memoryEmbeddingConfig: NimiMemoryEmbeddingConfigSurface;
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
): NimiProtectedHostMemoryEmbeddingConfigClient & NimiProtectedHostMemoryEmbeddingRuntimeClient {
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
  const configSurface = createNimiProtectedHostMemoryEmbeddingConfigSurface({
    runtime: getProtectedRuntime,
    getSubjectUserId,
  });
  const runtimeSurface = createNimiProtectedHostMemoryEmbeddingRuntimeSurface({
    runtime: getProtectedRuntime,
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
