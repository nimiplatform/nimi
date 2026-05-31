import {
  createRuntimeRouteModelPickerProvider,
  createRuntimeRouteModelPickerProviderCache,
  type RouteModelPickerDataProvider,
  type RuntimeRouteModelPickerClient,
} from '@nimiplatform/kit/features/model-picker/runtime';
import { getRuntimePlatformProjection } from '../shell/auth/runtime-platform.js';

// Tester model-picker data flows through the single canonical SDK projection
// (`listRuntimeRouteOptions`), wrapped by the Kit snapshot adapter. The Tester
// owns no local connector enumeration, capability filtering, or local-model
// projection: those are SDK-owned and shared with Desktop so both apps surface
// an identical route catalog. Runtime unavailability fails closed.
export function createTesterRuntimeModelPickerProvider(
  capability: string,
): RouteModelPickerDataProvider {
  return createRuntimeRouteModelPickerProvider({
    capability,
    getClient: async () => {
      const projection = await getRuntimePlatformProjection();
      if (projection.status !== 'ready') {
        throw new Error(projection.message || 'Runtime unavailable; model catalog failed closed.');
      }
      return projection.client as RuntimeRouteModelPickerClient;
    },
  });
}

export function createTesterRuntimeModelPickerProviderCache(): (
  capability: string,
) => RouteModelPickerDataProvider | null {
  return createRuntimeRouteModelPickerProviderCache({
    getClient: async () => {
      const projection = await getRuntimePlatformProjection();
      if (projection.status !== 'ready') {
        throw new Error(projection.message || 'Runtime unavailable; model catalog failed closed.');
      }
      return projection.client as RuntimeRouteModelPickerClient;
    },
  });
}

export function createTesterRuntimeModelPickerProviderFromClient(
  client: RuntimeRouteModelPickerClient,
  capability: string,
): RouteModelPickerDataProvider {
  return createRuntimeRouteModelPickerProvider({
    client,
    capability,
  });
}
