import {
  createSnapshotRouteDataProvider,
  type RouteModelPickerDataProvider,
} from '@nimiplatform/nimi-kit/features/model-picker';
import { loadDesktopRouteOptions } from './desktop-route-options-service';

const providerCache = new Map<string, RouteModelPickerDataProvider | null>();

export function getDesktopRouteModelPickerProvider(capability: string): RouteModelPickerDataProvider | null {
  const normalizedCapability = String(capability || '').trim();
  if (!normalizedCapability) {
    return null;
  }

  if (providerCache.has(normalizedCapability)) {
    return providerCache.get(normalizedCapability) || null;
  }

  try {
    const provider = createSnapshotRouteDataProvider(
      () => loadDesktopRouteOptions(
        normalizedCapability as Parameters<typeof loadDesktopRouteOptions>[0],
      ),
    );
    providerCache.set(normalizedCapability, provider);
    return provider;
  } catch {
    providerCache.set(normalizedCapability, null);
    return null;
  }
}
