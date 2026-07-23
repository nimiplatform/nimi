import { createNimiRuntimeLocalModelCenterClient } from '@nimiplatform/sdk/runtime';
import { getDesktopLocalAssetAdminClient } from '../infra/sdk/desktop-nimi-client-session';

export const firstRunRuntimeLocalClient = createNimiRuntimeLocalModelCenterClient({
  local: getDesktopLocalAssetAdminClient,
});
