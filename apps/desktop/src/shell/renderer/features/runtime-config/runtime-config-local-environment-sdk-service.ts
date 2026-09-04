import { useMemo } from 'react';
import {
  createNimiRuntimeLocalEnvironmentClient,
} from '@nimiplatform/sdk/runtime';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';

export function createRuntimeConfigLocalEnvironmentClient(
  local: DesktopRendererSdkPort['localEnvironmentRpc'],
) {
  return createNimiRuntimeLocalEnvironmentClient({ local });
}

export type RuntimeConfigLocalEnvironmentClient = ReturnType<
  typeof createRuntimeConfigLocalEnvironmentClient
>;

export function useRuntimeConfigLocalEnvironmentClient(): RuntimeConfigLocalEnvironmentClient {
  const sdk = useDesktopRendererSdk();
  return useMemo(
    () => createRuntimeConfigLocalEnvironmentClient(() => sdk.localEnvironmentRpc()),
    [sdk],
  );
}
