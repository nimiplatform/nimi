import { createNimiAppRuntimePlatformClient } from '@nimiplatform/sdk/app';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';

/**
 * The sole Tester entry point into the 0K local-app carrier. The SDK owns all
 * projection validation; the app never receives principal, permission-decision,
 * session, or transport authority material.
 */
export const testerLocalAppRuntimePlatform = createNimiAppRuntimePlatformClient({
  standardShell: createNimiLocalAppStandardShellSurface(),
});
