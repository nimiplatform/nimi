import type {
  NimiRuntimeCanonicalCapability,
  NimiRuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/runtime';
import { loadRuntimeRouteOptions } from '../../infra/bootstrap/runtime-bootstrap-route-options';

export async function loadDesktopRouteOptions(
  capability: NimiRuntimeCanonicalCapability,
  input?: { targetId?: string },
): Promise<NimiRuntimeRouteOptionsSnapshot> {
  return loadRuntimeRouteOptions({ capability, targetId: input?.targetId });
}
