import { createModRuntimeClient } from '@nimiplatform/sdk/mod';
import {
  createSnapshotRouteDataProvider,
  type RouteModelPickerDataProvider,
} from '@nimiplatform/nimi-kit/features/model-picker';

const CORE_RUNTIME_MOD_ID = 'core:runtime';

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
    const modClient = createModRuntimeClient(CORE_RUNTIME_MOD_ID);
    const provider = createSnapshotRouteDataProvider(
      () => modClient.route.listOptions({
        capability: normalizedCapability as Parameters<typeof modClient.route.listOptions>[0]['capability'],
      }),
    );
    providerCache.set(normalizedCapability, provider);
    return provider;
  } catch {
    providerCache.set(normalizedCapability, null);
    return null;
  }
}
