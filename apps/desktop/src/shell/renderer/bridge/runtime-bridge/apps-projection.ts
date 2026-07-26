// Desktop Apps bridge projection client.
//
// The Desktop bridge invokes the Kit standard `platformProjection.get` command
// for `apps-bridge`. The returned record is decoded by the SDK Nimi App
// surface so Desktop does not maintain a second registry/admission/release-
// descriptor parser.

import {
  parseNimiAppBridgeProjection,
  type NimiAppBridgeProjection,
} from '@nimiplatform/sdk/app';
import {
  getShellPlatformProjection,
  hasShellHostInvoke,
} from '@nimiplatform/kit/shell/renderer/bridge';

export type AppsBridgeProjection = NimiAppBridgeProjection;

/**
 * Invoke the standard `platformProjection.get` shell command.
 *
 * Ensures `<dataRoot>/apps/registry.json` is materialized, then returns the SDK
 * Nimi App registry/descriptor loader payloads. Package readiness is read
 * through Runtime `GetAppPackageReadiness`, not this shell projection.
 * Requires a standard shell host; Desktop does not keep an app-local fallback.
 */
export async function getAppsBridgeProjection(): Promise<AppsBridgeProjection> {
  if (!hasShellHostInvoke()) {
    throw new Error('platformProjection.get apps-bridge requires a standard shell host');
  }
  const projection = await getShellPlatformProjection({ projectionId: 'apps-bridge' });
  return parseNimiAppBridgeProjection(projection.record);
}
