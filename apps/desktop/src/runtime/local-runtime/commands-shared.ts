import { getPlatformClient } from '@nimiplatform/sdk';
import type {
  LocalRuntimeAssetRecord,
  LocalRuntimeExecutionPlan,
  LocalRuntimeListAssetsPayload,
  LocalRuntimeServiceDescriptor,
} from './types';
import { localIdsMatch, toCanonicalLocalLookupKey } from './local-id';

export type LocalClient = ReturnType<typeof getPlatformClient>['runtime']['local'];

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
  if (status === 'installed') return 1;
  if (status === 'active') return 2;
  if (status === 'unhealthy') return 3;
  if (status === 'removed') return 4;
  return 0;
}

export function toAssetKindFilter(kind?: LocalRuntimeListAssetsPayload['kind']): number {
  if (kind === 'chat') return 1;
  if (kind === 'image') return 2;
  if (kind === 'video') return 3;
  if (kind === 'tts') return 4;
  if (kind === 'stt') return 5;
  if (kind === 'embedding') return 6;
  if (kind === 'vae') return 10;
  if (kind === 'clip') return 11;
  if (kind === 'lora') return 12;
  if (kind === 'controlnet') return 13;
  if (kind === 'auxiliary') return 14;
  return 0;
}

export function assetLookupKey(
  asset: Pick<LocalRuntimeAssetRecord, 'assetId' | 'kind' | 'engine'>,
): string {
  return [
    toCanonicalLocalLookupKey(asset.assetId),
    String(asset.kind || '').trim().toLowerCase(),
    String(asset.engine || '').trim().toLowerCase(),
  ].join('::');
}

export function assetMatchesDependency(
  dependency: LocalRuntimeExecutionPlan['entries'][number],
  asset: LocalRuntimeAssetRecord,
): boolean {
  const modelId = String(dependency.modelId || '').trim();
  const engine = String(dependency.engine || '').trim().toLowerCase();
  if (modelId && !localIdsMatch(asset.assetId, modelId)) {
    return false;
  }
  if (engine && String(asset.engine || '').trim().toLowerCase() !== engine) {
    return false;
  }
  return Boolean(modelId);
}

export function serviceMatchesDependency(
  dependency: LocalRuntimeExecutionPlan['entries'][number],
  service: LocalRuntimeServiceDescriptor,
): boolean {
  const serviceId = String(dependency.serviceId || '').trim().toLowerCase();
  if (!serviceId) {
    return false;
  }
  return String(service.serviceId || '').trim().toLowerCase() === serviceId;
}
