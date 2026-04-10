import { createModRuntimeClient } from '@nimiplatform/sdk/mod';
import {
  createSnapshotRouteDataProvider,
  type RouteModelPickerDataProvider,
} from '@nimiplatform/nimi-kit/features/model-picker';

const CORE_RUNTIME_MOD_ID = 'core:runtime';

const providerCache = new Map<string, RouteModelPickerDataProvider | null>();

export function getParentosRouteModelPickerProvider(capability: string): RouteModelPickerDataProvider | null {
  const normalized = String(capability || '').trim();
  if (!normalized) return null;

  if (providerCache.has(normalized)) {
    return providerCache.get(normalized) || null;
  }

  try {
    const modClient = createModRuntimeClient(CORE_RUNTIME_MOD_ID);
    const provider = createSnapshotRouteDataProvider(
      () => modClient.route.listOptions({
        capability: normalized as Parameters<typeof modClient.route.listOptions>[0]['capability'],
      }),
    );
    providerCache.set(normalized, provider);
    return provider;
  } catch {
    providerCache.set(normalized, null);
    return null;
  }
}
