/**
 * Local App Access posture for a renderer launched by `nimi-app dev`.
 * Pass the Kit `createNimiLocalAppStandardShellSurface()` result from the App
 * shell; registration and host-private identity never enter this module.
 */

import {
  createNimiClient,
  type NimiLocalAppStandardShell,
} from '@nimiplatform/sdk';

export type LocalAppAccessPosture = {
  readonly sessionBound: boolean;
  readonly accessAvailable: false;
  readonly reasonCode: 'SDK_LOCAL_APP_ACCESS_UNAVAILABLE';
};

export async function readLocalAppAccessPosture(
  standardShell: NimiLocalAppStandardShell,
): Promise<LocalAppAccessPosture> {
  const app = createNimiClient({ localApp: { standardShell } });
  const session = await app.auth.status();

  try {
    await app.storage.readJson('examples/posture.json');
  } catch (error) {
    if ((error as { reasonCode?: unknown }).reasonCode === 'SDK_LOCAL_APP_ACCESS_UNAVAILABLE') {
      return {
        sessionBound: session.sessionBound,
        accessAvailable: false,
        reasonCode: 'SDK_LOCAL_APP_ACCESS_UNAVAILABLE',
      };
    }
    throw error;
  }

  throw new Error('Protected App operation returned success before App Access ingress is available.');
}
