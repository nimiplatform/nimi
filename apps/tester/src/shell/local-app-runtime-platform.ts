import { createNimiClient } from '@nimiplatform/sdk';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';

/**
 * The sole Tester entry point into the 0K local-app carrier. The SDK owns all
 * projection validation; the app never receives principal, permission-decision,
 * session, or transport authority material.
 */
export const testerLocalAppClient = createNimiClient({
  localApp: {
    standardShell: createNimiLocalAppStandardShellSurface(),
  },
});
