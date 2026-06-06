import {
  toCanonicalLocalRuntimeAssetLookupKey,
} from '../local-asset-id.js';
import {
  toLocalRuntimeAssetKindRequestValue,
  toLocalRuntimeAssetStatusRequestValue,
} from '../local-asset-kind.js';
import type { RuntimeLocalServiceClient } from '../types-client-interfaces.js';
import type {
  LocalRuntimeAssetRecord,
  LocalRuntimeListAssetsPayload,
} from './types.js';

type LocalClient = RuntimeLocalServiceClient;
type LocalRuntimeClientWarning = {
  level: 'warn';
  area: 'local-ai';
  message: string;
  details?: Record<string, unknown>;
};

let localClientProvider: (() => LocalClient | null) | null = null;
let warningListener: ((warning: LocalRuntimeClientWarning) => void) | null = null;

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function getSdkLocal(): LocalClient | null {
  try {
    return localClientProvider?.() ?? null;
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

export function bindLocalRuntimeServiceClientProvider(provider: () => LocalClient | null): () => void {
  localClientProvider = provider;
  return () => {
    if (localClientProvider === provider) {
      localClientProvider = null;
    }
  };
}

export function bindLocalRuntimeClientWarningListener(
  listener: ((warning: LocalRuntimeClientWarning) => void) | null,
): () => void {
  warningListener = listener;
  return () => {
    if (warningListener === listener) {
      warningListener = null;
    }
  };
}

export function emitLocalRuntimeClientWarning(warning: LocalRuntimeClientWarning): void {
  warningListener?.(warning);
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
