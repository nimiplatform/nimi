import { createContext, useContext, useMemo } from 'react';
import {
  createNimiRuntimeLocalEnvironmentClient,
} from '@nimiplatform/sdk/runtime';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';

// The global observer keeps polling while a local mutation can create a task.
// This is an observation hint; Runtime still owns every task and its state.
export const RuntimeDownloadActivityContext = createContext<(() => () => void) | undefined>(undefined);

export function createRuntimeConfigLocalEnvironmentClient(
  local: DesktopRendererSdkPort['localEnvironmentRpc'],
  onDownloadStart?: () => () => void,
) {
  const client = createNimiRuntimeLocalEnvironmentClient({ local });
  const observe = async <T>(operation: () => Promise<T>): Promise<T> => {
    const finish = onDownloadStart?.();
    try {
      return await operation();
    } finally {
      finish?.();
    }
  };
  return {
    ...client,
    install: (...args: Parameters<typeof client.install>) => observe(() => client.install(...args)),
    importModelAsset: (...args: Parameters<typeof client.importModelAsset>) => observe(() => client.importModelAsset(...args)),
    resumeTransfer: (...args: Parameters<typeof client.resumeTransfer>) => observe(() => client.resumeTransfer(...args)),
    applyEnvironmentPlan: (...args: Parameters<typeof client.applyEnvironmentPlan>) => observe(() => client.applyEnvironmentPlan(...args)),
    startEnvironmentDependencyJob: (...args: Parameters<typeof client.startEnvironmentDependencyJob>) => observe(() => client.startEnvironmentDependencyJob(...args)),
    retryEnvironmentDependencyJob: (...args: Parameters<typeof client.retryEnvironmentDependencyJob>) => observe(() => client.retryEnvironmentDependencyJob(...args)),
    repairEnvironmentDependency: (...args: Parameters<typeof client.repairEnvironmentDependency>) => observe(() => client.repairEnvironmentDependency(...args)),
  };
}

export type RuntimeConfigLocalEnvironmentClient = ReturnType<
  typeof createRuntimeConfigLocalEnvironmentClient
>;

export function useRuntimeConfigLocalEnvironmentClient(): RuntimeConfigLocalEnvironmentClient {
  const sdk = useDesktopRendererSdk();
  const onDownloadStart = useContext(RuntimeDownloadActivityContext);
  return useMemo(
    () => createRuntimeConfigLocalEnvironmentClient(() => sdk.localEnvironmentRpc(), onDownloadStart),
    [sdk, onDownloadStart],
  );
}
