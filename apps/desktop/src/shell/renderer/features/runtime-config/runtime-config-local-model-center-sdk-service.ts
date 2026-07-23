import { useMemo } from 'react';
import {
  createNimiRuntimeLocalModelCenterClient,
} from '@nimiplatform/sdk/runtime';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';

export function createRuntimeConfigLocalModelCenterClient(
  local: ReturnType<DesktopRendererSdkPort['localAssetAdmin']>,
) {
  return createNimiRuntimeLocalModelCenterClient({ local: () => local });
}

export type RuntimeConfigLocalModelCenterClient = ReturnType<
  typeof createRuntimeConfigLocalModelCenterClient
>;

export function useRuntimeConfigLocalModelCenterClient(): RuntimeConfigLocalModelCenterClient {
  const sdk = useDesktopRendererSdk();
  return useMemo(
    () => createRuntimeConfigLocalModelCenterClient(sdk.localAssetAdmin()),
    [sdk],
  );
}
