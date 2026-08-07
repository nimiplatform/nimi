import { createNimiClient } from '@nimiplatform/sdk';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';

/**
 * Zhiyu's app-private storage entry point into the bounded local-app carrier.
 * SDK owns validation and keeps registered-subject, management-handle, session,
 * and transport authority material out of the app-visible projection.
 */
const zhiyuLocalAppClient = createNimiClient({
  localApp: {
    standardShell: createNimiLocalAppStandardShellSurface(),
  },
});

export const zhiyuLocalAppStorage = zhiyuLocalAppClient.storage;
