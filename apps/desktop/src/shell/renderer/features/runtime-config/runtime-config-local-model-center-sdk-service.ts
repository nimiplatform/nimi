import { useMemo } from 'react';
import {
  createNimiRuntimeLocalModelCenterClient,
  type Runtime,
} from '@nimiplatform/sdk/runtime';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';

export function createRuntimeConfigLocalModelCenterClient(local: Runtime['local']) {
  return createNimiRuntimeLocalModelCenterClient({ local: () => local });
}

export type RuntimeConfigLocalModelCenterClient = ReturnType<
  typeof createRuntimeConfigLocalModelCenterClient
>;

export function useRuntimeConfigLocalModelCenterClient(): RuntimeConfigLocalModelCenterClient {
  const sdk = useDesktopRendererSdk();
  return useMemo(
    () => createRuntimeConfigLocalModelCenterClient(sdk.runtime().local),
    [sdk],
  );
}
