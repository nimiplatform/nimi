import { getRuntimePlatformProjection, appId } from '../shell/auth/runtime-platform.js';
import { resolveRuntimeAppStorageRoots } from '@nimiplatform/sdk/runtime';

export type TesterAppStorageRoots = {
  dataRoot: string;
  cacheRoot: string;
  tempRoot: string;
};

export async function getTesterAppStorageRoots(): Promise<TesterAppStorageRoots> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    throw new Error(projection.message);
  }
  return resolveRuntimeAppStorageRoots({
    appLifecycle: projection.client.runtime.appLifecycle,
    appId,
    label: 'tester app',
  });
}
