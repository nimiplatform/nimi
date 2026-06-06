import { createNimiRuntimeLocalModelCenterClient } from '@nimiplatform/sdk/runtime';
import { getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';

export const runtimeConfigLocalModelCenterClient = createNimiRuntimeLocalModelCenterClient({
  local: () => getDesktopRuntime().local,
});
