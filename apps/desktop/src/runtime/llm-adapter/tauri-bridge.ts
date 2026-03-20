type TauriInvoke = (command: string, payload?: unknown) => Promise<unknown>;
type TauriCore = {
  invoke?: TauriInvoke;
};
type TauriLikeGlobal = {
  window?: {
    __TAURI__?: {
      core?: TauriCore;
    };
  };
  __TAURI__?: {
    core?: TauriCore;
  };
};

function readGlobalTauriInvoke(): TauriInvoke | null {
  const value = globalThis as TauriLikeGlobal;
  const windowCore = value.window?.__TAURI__?.core;
  const fromWindow = windowCore?.invoke;
  if (typeof fromWindow === 'function') {
    return fromWindow.bind(windowCore);
  }

  const globalCore = value.__TAURI__?.core;
  const fromGlobal = globalCore?.invoke;
  if (typeof fromGlobal === 'function') {
    return fromGlobal.bind(globalCore);
  }

  return null;
}

export function hasTauriInvoke() {
  return Boolean(readGlobalTauriInvoke());
}

export async function tauriInvoke<T>(command: string, payload: unknown = {}): Promise<T> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    throw new Error(`Tauri invoke unavailable for command: ${command}`);
  }

  return (await invoke(command, payload)) as T;
}

export type RuntimeModMediaCachePutInput = {
  mediaBase64: string;
  mimeType: string;
  extensionHint?: string;
};

export type RuntimeModMediaCachePutResult = {
  cacheKey: string;
  filePath: string;
  uri: string;
  mimeType: string;
  sizeBytes: number;
  existed: boolean;
};

export type RuntimeModMediaCacheGcResult = {
  scannedCount: number;
  removedCount: number;
  removedBytes: number;
  retainedCount: number;
};

function parseMediaCachePutResult(value: unknown): RuntimeModMediaCachePutResult | null {
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

function parseMediaCacheGcResult(value: unknown): RuntimeModMediaCacheGcResult | null {
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

export async function runtimeModMediaCachePut(
  input: RuntimeModMediaCachePutInput,
): Promise<RuntimeModMediaCachePutResult> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    throw new Error('RUNTIME_MOD_MEDIA_CACHE_UNAVAILABLE');
  }
  const mimeType = String(input.mimeType || '').trim();
  if (!mimeType) {
    throw new Error('RUNTIME_MOD_MEDIA_CACHE_MIME_TYPE_REQUIRED');
  }
  try {
    const result = await invoke('runtime_mod_media_cache_put', {
      payload: {
        mediaBase64: String(input.mediaBase64 || '').trim(),
        mimeType,
        extensionHint: String(input.extensionHint || '').trim() || undefined,
      },
    });
    const parsed = parseMediaCachePutResult(result);
    if (!parsed) {
      throw new Error('RUNTIME_MOD_MEDIA_CACHE_INVALID_RESULT');
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('RUNTIME_MOD_MEDIA_CACHE_PUT_FAILED', { cause: error });
  }
}

export async function runtimeModMediaCacheGc(maxAgeSeconds?: number): Promise<RuntimeModMediaCacheGcResult | null> {
  const invoke = readGlobalTauriInvoke();
  if (!invoke) {
    return null;
  }
  try {
    const result = await invoke('runtime_mod_media_cache_gc', {
      payload: typeof maxAgeSeconds === 'number' && Number.isFinite(maxAgeSeconds)
        ? { maxAgeSeconds: Math.max(1, Math.floor(maxAgeSeconds)) }
        : {},
    });
    return parseMediaCacheGcResult(result);
  } catch {
    return null;
  }
}
