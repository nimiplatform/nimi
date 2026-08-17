import { useMemo } from 'react';
import {
  createNimiRuntimeLocalAssetAdminClient,
} from '@nimiplatform/sdk/runtime';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';

export function createRuntimeConfigLocalAssetAdminClient(
  local: DesktopRendererSdkPort['localAssetAdmin'],
) {
  return createNimiRuntimeLocalAssetAdminClient({ local });
}

export type RuntimeConfigLocalAssetAdminClient = ReturnType<
  typeof createRuntimeConfigLocalAssetAdminClient
>;

export async function installRuntimeConfigCatalogAsset(
  client: RuntimeConfigLocalAssetAdminClient,
  templateId: string,
) {
  const plan = await client.resolveInstallPlan({ templateId });
  return client.install(plan.planId, { caller: 'core' });
}

export function useRuntimeConfigLocalAssetAdminClient(): RuntimeConfigLocalAssetAdminClient {
  const sdk = useDesktopRendererSdk();
  return useMemo(
    () => createRuntimeConfigLocalAssetAdminClient(() => sdk.localAssetAdmin()),
    [sdk],
  );
}
