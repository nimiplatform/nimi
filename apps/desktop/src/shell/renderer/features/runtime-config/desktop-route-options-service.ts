import type { RuntimeCanonicalCapability, RuntimeRouteOptionsSnapshot } from '@nimiplatform/sdk/mod';
import { loadRuntimeRouteOptions } from '@renderer/infra/bootstrap/runtime-bootstrap-route-options';

export async function loadDesktopRouteOptions(
  capability: RuntimeCanonicalCapability,
): Promise<RuntimeRouteOptionsSnapshot> {
  return loadRuntimeRouteOptions({ capability });
}
