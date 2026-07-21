import { useMemo } from 'react';
import {
  createRuntimeRouteModelPickerProviderCache,
  type RouteModelPickerDataProvider,
} from '@nimiplatform/kit/features/model-picker/runtime';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { loadDesktopRouteOptions } from './desktop-route-options-service';

export function useDesktopRouteModelPickerProviderResolver(): (
  capability: string,
) => RouteModelPickerDataProvider | null {
  const sdk = useDesktopRendererSdk();
  return useMemo(() => createRuntimeRouteModelPickerProviderCache({
    loadOptions: ({ capability, targetId }) => loadDesktopRouteOptions(
      capability,
      sdk,
      { targetId },
    ),
  }), [sdk]);
}
