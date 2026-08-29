import { createNimiClient } from '@nimiplatform/sdk';
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';

let avatarLocalAppClient: NimiLocalAppClient | null = null;

// The sole Avatar App Product Plane client. Native Avatar profiles carry only
// transport/window/custody mechanics and never select declaration coverage or
// product result semantics.
export function getAvatarLocalAppClient(): NimiLocalAppClient {
  avatarLocalAppClient ??= createNimiClient({
    localApp: { standardShell: createNimiLocalAppStandardShellSurface() },
  });
  return avatarLocalAppClient;
}
