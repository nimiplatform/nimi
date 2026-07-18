import { createNimiClient } from '@nimiplatform/sdk';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';

/**
 * Zhiyu's only renderer entry point into the bounded local-app carrier.
 * SDK owns validation and strips principal, permission-decision, session, and
 * transport authority material from the app-visible projection.
 */
export const zhiyuLocalAppClient = createNimiClient({
  localApp: {
    standardShell: createNimiLocalAppStandardShellSurface(),
  },
});
