import {
  createSnapshotRouteDataProvider,
  type RouteModelPickerDataProvider,
} from '@nimiplatform/nimi-kit/features/model-picker';
import { loadParentosRuntimeRouteOptions } from '../../infra/parentos-runtime-route-options.js';

const providerCache = new Map<string, RouteModelPickerDataProvider>();

export function getParentosRouteModelPickerProvider(capability: string): RouteModelPickerDataProvider | null {
  const normalized = String(capability || '').trim();
  if (!normalized) return null;

  if (providerCache.has(normalized)) {
    return providerCache.get(normalized) || null;
  }

  const provider = createSnapshotRouteDataProvider(
    () => loadParentosRuntimeRouteOptions(
      normalized as Parameters<typeof loadParentosRuntimeRouteOptions>[0],
    ),
  );
  providerCache.set(normalized, provider);
  return provider;
}
