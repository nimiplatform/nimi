import { hasTauriInvoke as hasTauriRuntime, invokeTauri } from '../tauri-api';

export function hasTauriInvoke() {
  return hasTauriRuntime();
}

export async function tauriInvoke<T>(command: string, payload: unknown = {}): Promise<T> {
  if (!hasTauriRuntime()) {
    throw new Error(`Tauri invoke unavailable for command: ${command}`);
  }
  return await invokeTauri<T>(command, payload);
}

export type RuntimePackageMediaCachePutInput = {
  mediaBase64: string;
  mimeType: string;
  extensionHint?: string;
};

export type RuntimePackageMediaCachePutResult = {
  cacheKey: string;
  filePath: string;
  uri: string;
  mimeType: string;
  sizeBytes: number;
  existed: boolean;
};

export type RuntimePackageMediaCacheGcResult = {
  scannedCount: number;
  removedCount: number;
  removedBytes: number;
  retainedCount: number;
};

function parseMediaCachePutResult(value: unknown): RuntimePackageMediaCachePutResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const cacheKey = String(record.cacheKey || '').trim();
  const filePath = String(record.filePath || '').trim();
  const uri = String(record.uri || '').trim();
  const mimeType = String(record.mimeType || '').trim();
  const sizeBytes = Number(record.sizeBytes);
  if (!cacheKey || !filePath || !uri || !mimeType || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return null;
  }
  return {
    cacheKey,
    filePath,
    uri,
    mimeType,
    sizeBytes: Math.floor(sizeBytes),
    existed: Boolean(record.existed),
  };
}

function parseMediaCacheGcResult(value: unknown): RuntimePackageMediaCacheGcResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const scannedCount = Number(record.scannedCount);
  const removedCount = Number(record.removedCount);
  const removedBytes = Number(record.removedBytes);
  const retainedCount = Number(record.retainedCount);
  if (!Number.isFinite(scannedCount) || !Number.isFinite(removedCount) || !Number.isFinite(removedBytes) || !Number.isFinite(retainedCount)) {
    return null;
  }
  return {
    scannedCount: Math.max(0, Math.floor(scannedCount)),
    removedCount: Math.max(0, Math.floor(removedCount)),
    removedBytes: Math.max(0, Math.floor(removedBytes)),
    retainedCount: Math.max(0, Math.floor(retainedCount)),
  };
}

export async function runtimePackageMediaCachePut(
  input: RuntimePackageMediaCachePutInput,
): Promise<RuntimePackageMediaCachePutResult> {
  if (!hasTauriRuntime()) {
    throw new Error('RUNTIME_PACKAGE_MEDIA_CACHE_UNAVAILABLE');
  }
  const mimeType = String(input.mimeType || '').trim();
  if (!mimeType) {
    throw new Error('RUNTIME_PACKAGE_MEDIA_CACHE_MIME_TYPE_REQUIRED');
  }
  try {
    const result = await invokeTauri('runtime_mod_media_cache_put', {
      payload: {
        mediaBase64: String(input.mediaBase64 || '').trim(),
        mimeType,
        extensionHint: String(input.extensionHint || '').trim() || undefined,
      },
    });
    const parsed = parseMediaCachePutResult(result);
    if (!parsed) {
      throw new Error('RUNTIME_PACKAGE_MEDIA_CACHE_INVALID_RESULT');
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('RUNTIME_PACKAGE_MEDIA_CACHE_PUT_FAILED', { cause: error });
  }
}

export async function runtimePackageMediaCacheGc(maxAgeSeconds?: number): Promise<RuntimePackageMediaCacheGcResult | null> {
  if (!hasTauriRuntime()) {
    return null;
  }
  try {
    const result = await invokeTauri('runtime_mod_media_cache_gc', {
      payload: typeof maxAgeSeconds === 'number' && Number.isFinite(maxAgeSeconds)
        ? { maxAgeSeconds: Math.max(1, Math.floor(maxAgeSeconds)) }
        : {},
    });
    return parseMediaCacheGcResult(result);
  } catch {
    return null;
  }
}
