import {
  listRuntimeRouteOptions,
  normalizeRuntimeRouteCapabilityToken,
  type RuntimeRouteOptionsClient,
} from '@nimiplatform/sdk/ai';
import {
  createSnapshotRouteDataProvider,
  type RouteModelPickerDataProvider,
} from '@nimiplatform/kit/features/model-picker';
import { getRuntimePlatformProjection } from '../shell/auth/runtime-platform.js';

// Tester model-picker data flows through the single canonical SDK projection
// (`listRuntimeRouteOptions`), wrapped by the Kit snapshot adapter. The Tester
// owns no local connector enumeration, capability filtering, or local-model
// projection: those are SDK-owned and shared with Desktop so both apps surface
// an identical route catalog. Runtime unavailability fails closed.
export function createTesterRuntimeModelPickerProvider(
  capability: string,
): RouteModelPickerDataProvider {
  return createSnapshotRouteDataProvider(async () => {
    const projection = await getRuntimePlatformProjection();
    if (projection.status !== 'ready') {
      throw new Error(projection.message || 'Runtime unavailable; model catalog failed closed.');
    }
    return listTesterRuntimeRouteOptions(projection.client, capability);
  });
}

export function createTesterRuntimeModelPickerProviderFromClient(
  client: RuntimeRouteOptionsClient,
  capability: string,
): RouteModelPickerDataProvider {
  return createSnapshotRouteDataProvider(() => listTesterRuntimeRouteOptions(client, capability));
}

function listTesterRuntimeRouteOptions(
  client: RuntimeRouteOptionsClient,
  capability: string,
) {
  const runtimeCapability = normalizeRuntimeRouteCapabilityToken(capability);
  if (!runtimeCapability) {
    throw new Error(`Unsupported Runtime capability: ${capability}`);
  }
  return listRuntimeRouteOptions(client, {
    capability: runtimeCapability,
  });
}
