import { getRuntimePlatformProjection, appId } from '../shell/auth/runtime-platform.js';

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
  const storage = await projection.client.runtime.appLifecycle.storage({ appId });
  if (storage.state === 'storage_unavailable' || storage.state === 'repair_required') {
    throw new Error(storage.detail || `tester app storage is ${storage.state}`);
  }
  if (!storage.durableDataRoot || !storage.cacheRoot || !storage.tempRoot) {
    throw new Error('tester app storage projection is missing required roots');
  }
  return {
    dataRoot: storage.durableDataRoot,
    cacheRoot: storage.cacheRoot,
    tempRoot: storage.tempRoot,
  };
}
