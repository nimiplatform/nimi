import {
  createRuntimeRouteModelPickerProviderCache,
  type RouteModelPickerDataProvider,
} from '@nimiplatform/kit/features/model-picker/runtime';
import { loadDesktopRouteOptions } from './desktop-route-options-service';

const resolveDesktopRouteModelPickerProvider = createRuntimeRouteModelPickerProviderCache({
  loadOptions: ({ capability, targetId }) => loadDesktopRouteOptions(capability, { targetId }),
});

export function getDesktopRouteModelPickerProvider(capability: string): RouteModelPickerDataProvider | null {
  return resolveDesktopRouteModelPickerProvider(capability);
}
