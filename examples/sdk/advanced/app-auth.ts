/**
 * Local-app authorization lifecycle for a renderer launched by `nimi-app dev`.
 * Pass the Kit `createNimiLocalAppStandardShellSurface()` result from the app
 * shell; authority material never enters this module.
 */

import {
  createNimiAppRuntimePlatformClient,
  type NimiAppRuntimePlatformStandardShell,
} from '@nimiplatform/sdk/app';

const RESERVED_AGENT_PERMISSION = 'agents.interact';

export async function runAppAuthorizationLifecycle(
  standardShell: NimiAppRuntimePlatformStandardShell,
): Promise<void> {
  const app = createNimiAppRuntimePlatformClient({ standardShell });
  const session = await app.auth.status();
  if (!session.sessionBound) {
    throw new Error(`${session.reasonCode}: ${session.actionHint}`);
  }

  // App-private JSON is a base entitlement. It needs no manifest permission,
  // user prompt, operation id, resource ref, or app-supplied account identity.
  const written = await app.storage.writeJson('examples/authority.json', {
    permissionModel: 'five-authority-classes',
  });
  const stored = await app.storage.readJson('examples/authority.json');
  console.log('app-private storage:', written.sizeBytes, stored.value);

  // Product permissions are semantic ids. The current catalog is fully
  // reserved, so Agent inventory and conversation methods are not exposed.
  const permission = await app.permissions.status(RESERVED_AGENT_PERMISSION);
  if (permission.posture !== 'unavailable' || permission.canRequest) {
    throw new Error('Reserved agents.interact permission unexpectedly became requestable.');
  }

  try {
    await app.permissions.request({
      permissionId: RESERVED_AGENT_PERMISSION,
      reason: 'Interact with an Agent selected through the future owner picker.',
    });
    throw new Error('Reserved permission request unexpectedly succeeded.');
  } catch (error) {
    if ((error as { reasonCode?: string }).reasonCode !== 'SDK_PERMISSION_NOT_ADMITTED') {
      throw error;
    }
    console.log('reserved permission remains unavailable:', RESERVED_AGENT_PERMISSION);
  }
}
