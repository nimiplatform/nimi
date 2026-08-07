import { useMemo } from 'react';
import {
  createNimiRuntimeLocalAssetAdminClient,
} from '@nimiplatform/sdk/runtime';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';

export function createRuntimeConfigLocalAssetAdminClient(
  local: ReturnType<DesktopRendererSdkPort['localAssetAdmin']>,
) {
  return createNimiRuntimeLocalAssetAdminClient({ local: () => local });
}

export type RuntimeConfigLocalAssetAdminClient = ReturnType<
  typeof createRuntimeConfigLocalAssetAdminClient
>;

export function useRuntimeConfigLocalAssetAdminClient(): RuntimeConfigLocalAssetAdminClient {
  const sdk = useDesktopRendererSdk();
  return useMemo(
    () => createRuntimeConfigLocalAssetAdminClient(sdk.localAssetAdmin()),
    [sdk],
  );
}
