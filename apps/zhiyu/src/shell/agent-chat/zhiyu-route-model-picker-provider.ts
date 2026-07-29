import {
  createRuntimeRouteModelPickerProviderCache,
  type RouteModelPickerDataProvider,
} from '@nimiplatform/kit/features/model-picker/runtime';
import {
  type NimiListRuntimeRouteOptionsInput,
  type NimiRuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/runtime';
import { requireZhiyuLocalAppCapability } from '../auth/runtime-platform';

async function loadZhiyuRuntimeRouteOptions(
  input: NimiListRuntimeRouteOptionsInput,
): Promise<NimiRuntimeRouteOptionsSnapshot> {
  void input;
  return requireZhiyuLocalAppCapability('route-options');
}

const resolveZhiyuRouteModelPickerProvider = createRuntimeRouteModelPickerProviderCache({
  loadOptions: loadZhiyuRuntimeRouteOptions,
  unavailableMessage: 'Zhiyu Runtime route model picker requires Electron Runtime bridge.',
});

export function getZhiyuRouteModelPickerProvider(capability: string): RouteModelPickerDataProvider | null {
  return resolveZhiyuRouteModelPickerProvider(capability);
}
