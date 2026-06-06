import { createNimiRuntimeLocalModelCenterClient } from '@nimiplatform/sdk/runtime';
import { getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';

export const firstRunRuntimeLocalClient = createNimiRuntimeLocalModelCenterClient({
  local: () => getDesktopRuntime().local,
});
