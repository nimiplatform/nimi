import {
  GpuMemoryModel,
  LocalAssetKind,
  LocalProfileEntryKind,
} from './generated/runtime/v1/local_runtime_types.js';

export type LocalRuntimeRunnableAssetKindId =
  | 'chat'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'embedding';

export type LocalRuntimePassiveAssetKindId =
  | 'vae'
  | 'clip'
  | 'lora'
  | 'controlnet'
  | 'auxiliary';

export type LocalRuntimeAssetKindId =
  | LocalRuntimeRunnableAssetKindId
  | LocalRuntimePassiveAssetKindId;

export type LocalProfileEntryKindId = 'service' | 'node' | 'asset';
export type LocalRuntimeGpuMemoryModelId = 'discrete' | 'unified';

const LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_PAIRS = [
  [LocalAssetKind.CHAT, 'chat'],
  [LocalAssetKind.IMAGE, 'image'],
  [LocalAssetKind.VIDEO, 'video'],
  [LocalAssetKind.TTS, 'tts'],
  [LocalAssetKind.STT, 'stt'],
  [LocalAssetKind.EMBEDDING, 'embedding'],
] as const satisfies readonly (readonly [
  LocalAssetKind,
  LocalRuntimeRunnableAssetKindId,
])[];

const LOCAL_RUNTIME_PASSIVE_ASSET_KIND_PAIRS = [
  [LocalAssetKind.VAE, 'vae'],
  [LocalAssetKind.CLIP, 'clip'],
  [LocalAssetKind.LORA, 'lora'],
  [LocalAssetKind.CONTROLNET, 'controlnet'],
  [LocalAssetKind.AUXILIARY, 'auxiliary'],
] as const satisfies readonly (readonly [
  LocalAssetKind,
  LocalRuntimePassiveAssetKindId,
])[];

const LOCAL_RUNTIME_ASSET_KIND_PAIRS = [
  ...LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_PAIRS,
  ...LOCAL_RUNTIME_PASSIVE_ASSET_KIND_PAIRS,
] as const;

const LOCAL_PROFILE_ENTRY_KIND_PAIRS = [
  [LocalProfileEntryKind.SERVICE, 'service'],
  [LocalProfileEntryKind.NODE, 'node'],
  [LocalProfileEntryKind.ASSET, 'asset'],
] as const satisfies readonly (readonly [
  LocalProfileEntryKind,
  LocalProfileEntryKindId,
])[];

const LOCAL_RUNTIME_GPU_MEMORY_MODEL_PAIRS = [
  [GpuMemoryModel.DISCRETE, 'discrete'],
  [GpuMemoryModel.UNIFIED, 'unified'],
] as const satisfies readonly (readonly [
  GpuMemoryModel,
  LocalRuntimeGpuMemoryModelId,
])[];

export const LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS = Object.freeze(
  LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_PAIRS.map(([, id]) => id),
) as readonly LocalRuntimeRunnableAssetKindId[];

export const LOCAL_RUNTIME_PASSIVE_ASSET_KIND_IDS = Object.freeze(
  LOCAL_RUNTIME_PASSIVE_ASSET_KIND_PAIRS.map(([, id]) => id),
) as readonly LocalRuntimePassiveAssetKindId[];

export const LOCAL_RUNTIME_ASSET_KIND_IDS = Object.freeze(
  LOCAL_RUNTIME_ASSET_KIND_PAIRS.map(([, id]) => id),
) as readonly LocalRuntimeAssetKindId[];

export function parseLocalRuntimeAssetKindId(value: unknown): LocalRuntimeAssetKindId | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  for (const [protoValue, id] of LOCAL_RUNTIME_ASSET_KIND_PAIRS) {
    if (
      value === protoValue ||
      raw === String(protoValue) ||
      lower === id ||
      lower === `local_asset_kind_${id}`
    ) {
      return id;
    }
  }
  return undefined;
}

export function toLocalRuntimeAssetKindRequestValue(value: unknown): LocalAssetKind {
  const id = parseLocalRuntimeAssetKindId(value);
  if (!id) {
    return LocalAssetKind.UNSPECIFIED;
  }
  return LOCAL_RUNTIME_ASSET_KIND_PAIRS.find(([, current]) => current === id)?.[0]
    ?? LocalAssetKind.UNSPECIFIED;
}

export function parseLocalProfileEntryKindId(value: unknown): LocalProfileEntryKindId | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  for (const [protoValue, id] of LOCAL_PROFILE_ENTRY_KIND_PAIRS) {
    if (
      value === protoValue ||
      raw === String(protoValue) ||
      lower === id ||
      lower === `local_profile_entry_kind_${id}`
    ) {
      return id;
    }
  }
  return undefined;
}

export function toLocalProfileEntryKindRequestValue(value: unknown): LocalProfileEntryKind {
  const id = parseLocalProfileEntryKindId(value);
  if (!id) {
    return LocalProfileEntryKind.UNSPECIFIED;
  }
  return LOCAL_PROFILE_ENTRY_KIND_PAIRS.find(([, current]) => current === id)?.[0]
    ?? LocalProfileEntryKind.UNSPECIFIED;
}

export function parseLocalRuntimeGpuMemoryModelId(value: unknown): LocalRuntimeGpuMemoryModelId | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  for (const [protoValue, id] of LOCAL_RUNTIME_GPU_MEMORY_MODEL_PAIRS) {
    if (
      value === protoValue ||
      raw === String(protoValue) ||
      lower === id ||
      lower === `gpu_memory_model_${id}`
    ) {
      return id;
    }
  }
  return undefined;
}

export function toLocalRuntimeGpuMemoryModelRequestValue(value: unknown): GpuMemoryModel {
  const id = parseLocalRuntimeGpuMemoryModelId(value);
  if (!id) {
    return GpuMemoryModel.UNSPECIFIED;
  }
  return LOCAL_RUNTIME_GPU_MEMORY_MODEL_PAIRS.find(([, current]) => current === id)?.[0]
    ?? GpuMemoryModel.UNSPECIFIED;
}

export function isLocalRuntimeRunnableAssetKindId(
  value: unknown,
): value is LocalRuntimeRunnableAssetKindId {
  const parsed = parseLocalRuntimeAssetKindId(value);
  return Boolean(parsed && (LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS as readonly string[]).includes(parsed));
}

export function isLocalRuntimePassiveAssetKindId(
  value: unknown,
): value is LocalRuntimePassiveAssetKindId {
  const parsed = parseLocalRuntimeAssetKindId(value);
  return Boolean(parsed && (LOCAL_RUNTIME_PASSIVE_ASSET_KIND_IDS as readonly string[]).includes(parsed));
}

export function normalizeLocalRuntimeAssetKindId(
  value: unknown,
  fallback: LocalRuntimeAssetKindId = 'chat',
): LocalRuntimeAssetKindId {
  return parseLocalRuntimeAssetKindId(value) ?? fallback;
}

export function normalizeLocalRuntimeRunnableAssetKindId(
  value: unknown,
  fallback: LocalRuntimeRunnableAssetKindId = 'chat',
): LocalRuntimeRunnableAssetKindId {
  const parsed = parseLocalRuntimeAssetKindId(value);
  return parsed && isLocalRuntimeRunnableAssetKindId(parsed) ? parsed : fallback;
}

export function localRuntimeCapabilitiesForAssetKind(kind: LocalRuntimeAssetKindId): string[] {
  return [isLocalRuntimeRunnableAssetKindId(kind) ? kind : 'chat'];
}
