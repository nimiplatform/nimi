import { createNimiClient } from '@nimiplatform/sdk';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';

/**
 * The sole Tester entry point into the 0K local-app carrier. The SDK owns all
 * projection validation; the App never receives a registration handle,
 * Registered App Subject, session proof, or transport authority material.
 */
export function getTesterLocalAppClient() {
  return createNimiClient({
    localApp: {
      standardShell: createNimiLocalAppStandardShellSurface(),
    },
  });
}
