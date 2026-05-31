import { getPlatformClient } from '@nimiplatform/sdk';
import {
  toCanonicalLocalRuntimeAssetLookupKey,
  toLocalRuntimeAssetKindRequestValue,
  toLocalRuntimeAssetStatusRequestValue,
} from '@nimiplatform/sdk/runtime';
import type {
  LocalRuntimeAssetRecord,
  LocalRuntimeListAssetsPayload,
} from './types';

type LocalClient = ReturnType<typeof getPlatformClient>['runtime']['local'];

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function getSdkLocal(): LocalClient | null {
  try {
    return getPlatformClient().runtime.local;
  } catch {
    return null;
  }
}

export function requireSdkLocal(): LocalClient {
  const runtime = getSdkLocal();
  if (!runtime) {
    throw new Error('Runtime local service unavailable');
  }
  return runtime;
}

export function toAssetStatusFilter(status?: LocalRuntimeListAssetsPayload['status']): number {
  return toLocalRuntimeAssetStatusRequestValue(status);
}

export function toAssetKindFilter(kind?: LocalRuntimeListAssetsPayload['kind']): number {
  return toLocalRuntimeAssetKindRequestValue(kind);
}

export function assetLookupKey(
  asset: Pick<LocalRuntimeAssetRecord, 'assetId' | 'kind' | 'engine'>,
): string {
  return [
    toCanonicalLocalRuntimeAssetLookupKey(asset.assetId),
    String(asset.kind || '').trim().toLowerCase(),
    String(asset.engine || '').trim().toLowerCase(),
  ].join('::');
}
