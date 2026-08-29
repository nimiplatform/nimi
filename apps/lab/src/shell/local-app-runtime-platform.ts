import { createNimiClient } from '@nimiplatform/sdk';
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';

let labLocalAppClient: NimiLocalAppClient | null = null;

/**
 * The sole Lab entry point into the 0K local-app carrier. The SDK owns all
 * projection validation; the App never receives a registration handle,
 * Registered App Subject, session proof, or transport authority material.
 */
export function getLabLocalAppClient() {
  labLocalAppClient ??= createNimiClient({
    localApp: { standardShell: createNimiLocalAppStandardShellSurface() },
  });
  return labLocalAppClient;
}
