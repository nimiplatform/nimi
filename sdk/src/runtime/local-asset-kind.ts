import {
  LocalAssetKind,
  LocalAssetStatus,
  LocalProfileEntryKind,
} from './generated/runtime/v1/local_runtime_asset_catalog.js';
import { GpuMemoryModel } from './generated/runtime/v1/local_runtime_device_environment.js';
import {
  RUNTIME_CAPABILITY_TO_ASSET_KIND_MAPPINGS,
  runtimeCanonicalCapabilityForLocalManifestToken,
} from './runtime-capability-vocabulary.generated.js';

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

export type LocalRuntimeAssetDeclarationLike = {
  assetKind?: LocalRuntimeAssetKindId | string | null;
  engine?: string | null;
};

export type NormalizedLocalRuntimeAssetDeclaration = {
  assetKind: LocalRuntimeAssetKindId;
  engine?: string;
};

export type LocalRuntimeAssetStatusId = 'installed' | 'active' | 'unhealthy' | 'removed';
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

const LOCAL_RUNTIME_ASSET_STATUS_PAIRS = [
  [LocalAssetStatus.INSTALLED, 'installed'],
  [LocalAssetStatus.ACTIVE, 'active'],
  [LocalAssetStatus.UNHEALTHY, 'unhealthy'],
  [LocalAssetStatus.REMOVED, 'removed'],
] as const satisfies readonly (readonly [
  LocalAssetStatus,
  LocalRuntimeAssetStatusId,
])[];

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

export const LOCAL_RUNTIME_ASSET_STATUS_IDS = Object.freeze(
  LOCAL_RUNTIME_ASSET_STATUS_PAIRS.map(([, id]) => id),
) as readonly LocalRuntimeAssetStatusId[];

export const LOCAL_RUNTIME_ASSET_KIND_LABELS = Object.freeze({
  chat: 'Chat',
  image: 'Image',
  video: 'Video',
  tts: 'TTS',
  stt: 'STT',
  embedding: 'Embedding',
  vae: 'VAE',
  clip: 'CLIP',
  lora: 'LoRA',
  controlnet: 'ControlNet',
  auxiliary: 'Auxiliary',
} satisfies Record<LocalRuntimeAssetKindId, string>);

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

export function parseLocalRuntimeAssetStatusId(value: unknown): LocalRuntimeAssetStatusId | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  for (const [protoValue, id] of LOCAL_RUNTIME_ASSET_STATUS_PAIRS) {
    if (
      value === protoValue ||
      raw === String(protoValue) ||
      lower === id ||
      lower === `local_asset_status_${id}`
    ) {
      return id;
    }
  }
  return undefined;
}

export function normalizeLocalRuntimeAssetStatusId(
  value: unknown,
  fallback: LocalRuntimeAssetStatusId = 'installed',
): LocalRuntimeAssetStatusId {
  return parseLocalRuntimeAssetStatusId(value) ?? fallback;
}

export function toLocalRuntimeAssetStatusRequestValue(value: unknown): LocalAssetStatus {
  const id = parseLocalRuntimeAssetStatusId(value);
  if (!id) {
    return LocalAssetStatus.UNSPECIFIED;
  }
  return LOCAL_RUNTIME_ASSET_STATUS_PAIRS.find(([, current]) => current === id)?.[0]
    ?? LocalAssetStatus.UNSPECIFIED;
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

export function normalizeLocalRuntimePassiveAssetKindId(
  value: unknown,
  fallback: LocalRuntimePassiveAssetKindId = 'vae',
): LocalRuntimePassiveAssetKindId {
  const parsed = parseLocalRuntimeAssetKindId(value);
  return parsed && isLocalRuntimePassiveAssetKindId(parsed) ? parsed : fallback;
}

export function formatLocalRuntimeAssetKindLabel(value: unknown): string {
  const parsed = parseLocalRuntimeAssetKindId(value);
  return parsed ? LOCAL_RUNTIME_ASSET_KIND_LABELS[parsed] : String(value ?? '').trim();
}

export function compareLocalRuntimeAssetKindForDisplay(left: unknown, right: unknown): number {
  const leftKind = parseLocalRuntimeAssetKindId(left);
  const rightKind = parseLocalRuntimeAssetKindId(right);
  const leftRank = leftKind ? LOCAL_RUNTIME_ASSET_KIND_IDS.indexOf(leftKind) : Number.MAX_SAFE_INTEGER;
  const rightRank = rightKind ? LOCAL_RUNTIME_ASSET_KIND_IDS.indexOf(rightKind) : Number.MAX_SAFE_INTEGER;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, { sensitivity: 'base' });
}

export function normalizeLocalRuntimeAssetDeclaration(
  declaration?: LocalRuntimeAssetDeclarationLike | null,
  fallback: LocalRuntimeAssetKindId = 'chat',
): NormalizedLocalRuntimeAssetDeclaration {
  const normalizedKind = normalizeLocalRuntimeAssetKindId(declaration?.assetKind, fallback);
  const engine = String(declaration?.engine || '').trim();
  return {
    assetKind: normalizedKind,
    ...(engine ? { engine } : {}),
  };
}

export function normalizeLocalRuntimeDependencyAssetDeclaration(
  declaration?: LocalRuntimeAssetDeclarationLike | null,
  fallback: LocalRuntimePassiveAssetKindId = 'vae',
): NormalizedLocalRuntimeAssetDeclaration {
  const normalizedKind = normalizeLocalRuntimePassiveAssetKindId(declaration?.assetKind, fallback);
  const engine = String(declaration?.engine || '').trim();
  return {
    assetKind: normalizedKind,
    ...(engine ? { engine } : {}),
  };
}

export function canImportLocalRuntimeAssetDeclaration(
  declaration?: LocalRuntimeAssetDeclarationLike | null,
): boolean {
  const assetKind = parseLocalRuntimeAssetKindId(declaration?.assetKind);
  if (!assetKind) {
    return false;
  }
  if (assetKind === 'auxiliary') {
    return Boolean(String(declaration?.engine || '').trim());
  }
  return true;
}

export function localRuntimeCapabilitiesForAssetKind(kind: LocalRuntimeAssetKindId): string[] {
  const parsed = parseLocalRuntimeAssetKindId(kind);
  if (!parsed || !isLocalRuntimeRunnableAssetKindId(parsed)) {
    return [];
  }
  const canonical = runtimeCanonicalCapabilityForLocalManifestToken(parsed);
  return canonical ? [canonical] : [];
}

export function localRuntimeRunnableAssetKindForCapabilities(
  capabilities: readonly unknown[] | undefined,
  fallback: LocalRuntimeRunnableAssetKindId = 'chat',
): LocalRuntimeRunnableAssetKindId {
  const normalized = new Set(
    (Array.isArray(capabilities) ? capabilities : [])
      .map((item) => String(item ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  for (const kind of LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS) {
    if (normalized.has(kind)) {
      return kind;
    }
  }
  for (const mapping of RUNTIME_CAPABILITY_TO_ASSET_KIND_MAPPINGS) {
    if (
      normalized.has(mapping.token)
      && isLocalRuntimeRunnableAssetKindId(mapping.assetKind)
    ) {
      return mapping.assetKind;
    }
  }
  return fallback;
}
