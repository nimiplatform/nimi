import { getRuntimePlatformProjection, appId } from '../shell/auth/runtime-platform.js';
import {
  attachRuntimeAppDataStorageRoot,
  attachRuntimeAppStorageRoots,
  resolveRuntimeAppStorageRoots,
} from '@nimiplatform/sdk/runtime';

export type TesterAppStorageRoots = {
  dataRoot: string;
  cacheRoot: string;
  tempRoot: string;
};

export async function getTesterAppStorageRoots(): Promise<TesterAppStorageRoots> {
  return resolveRuntimeAppStorageRoots(await testerStorageInput('tester app'));
}

export async function withTesterDataStorageRoot<T extends Record<string, unknown>>(
  payload: T,
): Promise<T & { storageRoot: string }> {
  return attachRuntimeAppDataStorageRoot({
    ...(await testerStorageInput('tester app')),
    payload,
  });
}

export async function withTesterAppStorageRoots<T extends Record<string, unknown>>(
  payload: T,
): Promise<T & TesterAppStorageRoots> {
  return attachRuntimeAppStorageRoots({
    ...(await testerStorageInput('tester app')),
    payload,
  });
}

async function testerStorageInput(label: string) {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    throw new Error(projection.message);
  }
  return {
    appLifecycle: projection.client.runtime.appLifecycle,
    appId,
    label,
  };
}
