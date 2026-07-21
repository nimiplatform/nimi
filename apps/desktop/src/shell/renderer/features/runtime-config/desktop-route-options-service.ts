import type {
  NimiRuntimeCanonicalCapability,
  NimiRuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/runtime';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';

export async function loadDesktopRouteOptions(
  capability: NimiRuntimeCanonicalCapability,
  sdk: Pick<DesktopRendererSdkPort, 'loadRouteOptions'>,
  input?: { targetId?: string },
): Promise<NimiRuntimeRouteOptionsSnapshot> {
  return sdk.loadRouteOptions(capability, input?.targetId);
}
