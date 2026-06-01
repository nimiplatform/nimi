// Desktop Apps bridge projection client.
//
// The Desktop bridge invokes the shell-owned `apps_bridge_projection_get`
// command. The returned payload is decoded by the SDK Nimi App surface so
// Desktop does not maintain a second registry/admission/release-descriptor
// parser.

import {
  parseNimiAppBridgeProjection,
  type NimiAppBridgeProjection,
} from '@nimiplatform/sdk/app';
import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';

export type AppsBridgeProjection = NimiAppBridgeProjection;

/**
 * Invoke the `apps_bridge_projection_get` Tauri command.
 *
 * Ensures `~/.nimi/apps/registry.json` is materialized, then returns the SDK
 * Nimi App registry/descriptor loader payloads. Package readiness is read
 * through Runtime `GetAppPackageReadiness`, not this Tauri projection.
 * Requires the Tauri runtime — the Apps bridge has no non-desktop source.
 */
export async function getAppsBridgeProjection(): Promise<AppsBridgeProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('apps_bridge_projection_get requires the desktop Tauri runtime');
  }
  return invokeChecked('apps_bridge_projection_get', {}, parseNimiAppBridgeProjection);
}
