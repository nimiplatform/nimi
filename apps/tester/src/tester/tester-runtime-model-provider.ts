import {
  createRuntimeRouteModelPickerProvider,
  createRuntimeRouteModelPickerProviderCache,
  type RouteModelPickerDataProvider,
  type RuntimeRouteModelPickerClient,
} from '@nimiplatform/kit/features/model-picker/runtime';
import {
  createNimiRuntimeRouteOptionsHostDeps,
  listNimiRuntimeRouteOptionsWithHost,
  type NimiListRuntimeRouteOptionsInput,
  type NimiRuntimeRouteOptionsHostRuntime,
  type NimiRuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/runtime';
import { getRuntimePlatformProjection } from '../shell/auth/runtime-platform.js';

// Tester model-picker data flows through the single canonical SDK projection
// (`listRuntimeRouteOptions`), wrapped by the Kit snapshot adapter. The Tester
// owns no local connector enumeration, capability filtering, or local-model
// projection: those are SDK-owned and shared with Desktop so both apps surface
// an identical route catalog. Runtime unavailability fails closed.

type TesterRuntimeRouteOptionsHostClient = {
  readonly runtime: NimiRuntimeRouteOptionsHostRuntime;
};

async function loadTesterRuntimeRouteOptions(
  client: TesterRuntimeRouteOptionsHostClient,
  input: NimiListRuntimeRouteOptionsInput,
): Promise<NimiRuntimeRouteOptionsSnapshot> {
  return listNimiRuntimeRouteOptionsWithHost(
    input,
    createNimiRuntimeRouteOptionsHostDeps(client.runtime, { scope: client }),
  );
}

async function loadTesterRuntimeRouteOptionsFromProjection(
  input: NimiListRuntimeRouteOptionsInput,
): Promise<NimiRuntimeRouteOptionsSnapshot> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    throw new Error(projection.message || 'Runtime unavailable; model catalog failed closed.');
  }
  throw new Error('Runtime model catalog is not admitted for this app-host authorization.');
}

export function createTesterRuntimeModelPickerProvider(
  capability: string,
): RouteModelPickerDataProvider {
  return createRuntimeRouteModelPickerProvider({
    capability,
    loadOptions: loadTesterRuntimeRouteOptionsFromProjection,
  });
}

export function createTesterRuntimeModelPickerProviderCache(): (
  capability: string,
) => RouteModelPickerDataProvider | null {
  return createRuntimeRouteModelPickerProviderCache({
    loadOptions: loadTesterRuntimeRouteOptionsFromProjection,
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

export function createTesterRuntimeModelPickerProviderFromHostClient(
  client: TesterRuntimeRouteOptionsHostClient,
  capability: string,
): RouteModelPickerDataProvider {
  return createRuntimeRouteModelPickerProvider({
    capability,
    loadOptions: (input) => loadTesterRuntimeRouteOptions(client, input),
  });
}
