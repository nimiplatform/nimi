import {
  LocalAssetKind,
  LocalEngineRuntimeMode,
} from '../core-generated/runtime-typed-client';
import { GpuMemoryModel } from '../core-generated/runtime-typed-client';

export type NimiRuntimeLocalRunnableAssetKindId =
  | 'chat'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'embedding';

export type NimiRuntimeLocalPassiveAssetKindId =
  | 'vae'
  | 'clip'
  | 'lora'
  | 'controlnet'
  | 'auxiliary';

export type NimiRuntimeLocalAssetKindId =
  | NimiRuntimeLocalRunnableAssetKindId
  | NimiRuntimeLocalPassiveAssetKindId;

export type NimiRuntimeLocalGpuMemoryModelId = 'discrete' | 'unified';
export type NimiRuntimeLocalEngineId = 'llama' | 'media' | 'speech' | 'sidecar';
export type NimiRuntimeLocalEngineRuntimeModeId = 'supervised' | 'attached-endpoint';

const NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_PAIRS = [
  [LocalAssetKind.CHAT, 'chat'],
  [LocalAssetKind.IMAGE, 'image'],
  [LocalAssetKind.VIDEO, 'video'],
  [LocalAssetKind.TTS, 'tts'],
  [LocalAssetKind.STT, 'stt'],
  [LocalAssetKind.EMBEDDING, 'embedding'],
] as const satisfies readonly (readonly [
  LocalAssetKind,
  NimiRuntimeLocalRunnableAssetKindId,
])[];

const NIMI_RUNTIME_LOCAL_PASSIVE_ASSET_KIND_PAIRS = [
  [LocalAssetKind.VAE, 'vae'],
  [LocalAssetKind.CLIP, 'clip'],
  [LocalAssetKind.LORA, 'lora'],
  [LocalAssetKind.CONTROLNET, 'controlnet'],
  [LocalAssetKind.AUXILIARY, 'auxiliary'],
] as const satisfies readonly (readonly [
  LocalAssetKind,
  NimiRuntimeLocalPassiveAssetKindId,
])[];

const NIMI_RUNTIME_LOCAL_ASSET_KIND_PAIRS = [
  ...NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_PAIRS,
  ...NIMI_RUNTIME_LOCAL_PASSIVE_ASSET_KIND_PAIRS,
] as const;

const NIMI_RUNTIME_LOCAL_GPU_MEMORY_MODEL_PAIRS = [
  [GpuMemoryModel.DISCRETE, 'discrete'],
  [GpuMemoryModel.UNIFIED, 'unified'],
] as const satisfies readonly (readonly [
  GpuMemoryModel,
  NimiRuntimeLocalGpuMemoryModelId,
])[];

const NIMI_RUNTIME_LOCAL_ENGINE_RUNTIME_MODE_PAIRS = [
  [LocalEngineRuntimeMode.SUPERVISED, 'supervised'],
  [LocalEngineRuntimeMode.ATTACHED_ENDPOINT, 'attached-endpoint'],
] as const satisfies readonly (readonly [
  LocalEngineRuntimeMode,
  NimiRuntimeLocalEngineRuntimeModeId,
])[];

export const NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_IDS = Object.freeze(
  NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_PAIRS.map(([, id]) => id),
) as readonly NimiRuntimeLocalRunnableAssetKindId[];

export const NIMI_RUNTIME_LOCAL_PASSIVE_ASSET_KIND_IDS = Object.freeze(
  NIMI_RUNTIME_LOCAL_PASSIVE_ASSET_KIND_PAIRS.map(([, id]) => id),
) as readonly NimiRuntimeLocalPassiveAssetKindId[];

export const NIMI_RUNTIME_LOCAL_ASSET_KIND_IDS = Object.freeze(
  NIMI_RUNTIME_LOCAL_ASSET_KIND_PAIRS.map(([, id]) => id),
) as readonly NimiRuntimeLocalAssetKindId[];

export const NIMI_RUNTIME_LOCAL_ENGINE_IDS = Object.freeze([
  'llama',
  'media',
  'speech',
  'sidecar',
] as const satisfies readonly NimiRuntimeLocalEngineId[]);

export const NIMI_RUNTIME_LOCAL_ENGINE_RUNTIME_MODE_IDS = Object.freeze(
  NIMI_RUNTIME_LOCAL_ENGINE_RUNTIME_MODE_PAIRS.map(([, id]) => id),
) as readonly NimiRuntimeLocalEngineRuntimeModeId[];

export const NIMI_RUNTIME_LOCAL_ASSET_KIND_LABELS = Object.freeze({
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
} satisfies Record<NimiRuntimeLocalAssetKindId, string>);

const CANONICAL_CAPABILITY_TO_ASSET_KIND = {
  'text.generate': 'chat',
  'text.embed': 'embedding',
  'image.generate': 'image',
  'video.generate': 'video',
  'audio.synthesize': 'tts',
  'audio.transcribe': 'stt',
  'voice.create': 'tts',
  'music.generate': 'auxiliary',
} as const satisfies Partial<Record<string, NimiRuntimeLocalAssetKindId>>;

export function parseNimiRuntimeLocalAssetKindId(value: unknown): NimiRuntimeLocalAssetKindId | undefined {
  const raw = normalizeLocalVocabularyText(value);
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  for (const [protoValue, id] of NIMI_RUNTIME_LOCAL_ASSET_KIND_PAIRS) {
    if (
      value === protoValue
      || raw === String(protoValue)
      || lower === id
      || lower === `local_asset_kind_${id}`
    ) {
      return id;
    }
  }
  return undefined;
}

export function parseNimiRuntimeLocalRunnableAssetKindId(
  value: unknown,
): NimiRuntimeLocalRunnableAssetKindId | undefined {
  const parsed = parseNimiRuntimeLocalAssetKindId(value);
  return parsed && isNimiRuntimeLocalRunnableAssetKindId(parsed) ? parsed : undefined;
}

export function parseNimiRuntimeLocalGpuMemoryModelId(
  value: unknown,
): NimiRuntimeLocalGpuMemoryModelId | undefined {
  const raw = normalizeLocalVocabularyText(value);
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  for (const [protoValue, id] of NIMI_RUNTIME_LOCAL_GPU_MEMORY_MODEL_PAIRS) {
    if (
      value === protoValue
      || raw === String(protoValue)
      || lower === id
      || lower === `gpu_memory_model_${id}`
    ) {
      return id;
    }
  }
  return undefined;
}

export function parseNimiRuntimeLocalEngineId(value: unknown): NimiRuntimeLocalEngineId | undefined {
  const normalized = normalizeLocalVocabularyText(value).toLowerCase();
  return (NIMI_RUNTIME_LOCAL_ENGINE_IDS as readonly string[]).includes(normalized)
    ? normalized as NimiRuntimeLocalEngineId
    : undefined;
}

export function parseNimiRuntimeLocalEngineRuntimeModeId(
  value: unknown,
): NimiRuntimeLocalEngineRuntimeModeId | undefined {
  const raw = normalizeLocalVocabularyText(value);
  if (typeof value === 'number') {
    return value === LocalEngineRuntimeMode.SUPERVISED
      ? 'supervised'
      : value === LocalEngineRuntimeMode.ATTACHED_ENDPOINT
        ? 'attached-endpoint'
        : undefined;
  }
  const lower = raw.toLowerCase();
  for (const [protoValue, id] of NIMI_RUNTIME_LOCAL_ENGINE_RUNTIME_MODE_PAIRS) {
    if (
      raw === String(protoValue)
      || lower === id
      || lower === id.replace('-', '_')
      || lower === `local_engine_runtime_mode_${id.replace('-', '_')}`
    ) {
      return id;
    }
  }
  return undefined;
}

export function toNimiRuntimeLocalAssetKindRequestValue(value: unknown): LocalAssetKind {
  const id = parseNimiRuntimeLocalAssetKindId(value);
  if (!id) {
    return LocalAssetKind.UNSPECIFIED;
  }
  return NIMI_RUNTIME_LOCAL_ASSET_KIND_PAIRS.find(([, current]) => current === id)?.[0]
    ?? LocalAssetKind.UNSPECIFIED;
}

export function toNimiRuntimeLocalGpuMemoryModelRequestValue(value: unknown): GpuMemoryModel {
  const id = parseNimiRuntimeLocalGpuMemoryModelId(value);
  if (!id) {
    return GpuMemoryModel.UNSPECIFIED;
  }
  return NIMI_RUNTIME_LOCAL_GPU_MEMORY_MODEL_PAIRS.find(([, current]) => current === id)?.[0]
    ?? GpuMemoryModel.UNSPECIFIED;
}

export function toNimiRuntimeLocalEngineRuntimeModeRequestValue(value: unknown): LocalEngineRuntimeMode {
  const id = parseNimiRuntimeLocalEngineRuntimeModeId(value);
  if (!id) {
    return LocalEngineRuntimeMode.UNSPECIFIED;
  }
  return NIMI_RUNTIME_LOCAL_ENGINE_RUNTIME_MODE_PAIRS.find(([, current]) => current === id)?.[0]
    ?? LocalEngineRuntimeMode.UNSPECIFIED;
}

export function isNimiRuntimeLocalRunnableAssetKindId(
  value: unknown,
): value is NimiRuntimeLocalRunnableAssetKindId {
  const parsed = parseNimiRuntimeLocalAssetKindId(value);
  return Boolean(parsed && (NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_IDS as readonly string[]).includes(parsed));
}

export function isNimiRuntimeLocalEngineId(value: unknown): value is NimiRuntimeLocalEngineId {
  return parseNimiRuntimeLocalEngineId(value) !== undefined;
}

export function normalizeNimiRuntimeLocalRunnableAssetKindId(
  value: unknown,
  fallback: NimiRuntimeLocalRunnableAssetKindId = 'chat',
): NimiRuntimeLocalRunnableAssetKindId {
  return parseNimiRuntimeLocalRunnableAssetKindId(value) ?? fallback;
}

export function normalizeNimiRuntimeLocalEngineId(
  value: unknown,
  fallback: NimiRuntimeLocalEngineId = 'llama',
): NimiRuntimeLocalEngineId {
  return parseNimiRuntimeLocalEngineId(value) ?? fallback;
}

export function formatNimiRuntimeLocalAssetKindLabel(value: unknown): string {
  const parsed = parseNimiRuntimeLocalAssetKindId(value);
  return parsed ? NIMI_RUNTIME_LOCAL_ASSET_KIND_LABELS[parsed] : normalizeLocalVocabularyText(value);
}

export function compareNimiRuntimeLocalAssetKindForDisplay(left: unknown, right: unknown): number {
  const leftKind = parseNimiRuntimeLocalAssetKindId(left);
  const rightKind = parseNimiRuntimeLocalAssetKindId(right);
  const leftRank = leftKind ? NIMI_RUNTIME_LOCAL_ASSET_KIND_IDS.indexOf(leftKind) : Number.MAX_SAFE_INTEGER;
  const rightRank = rightKind ? NIMI_RUNTIME_LOCAL_ASSET_KIND_IDS.indexOf(rightKind) : Number.MAX_SAFE_INTEGER;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, { sensitivity: 'base' });
}

export function nimiRuntimeLocalRunnableAssetKindForCapabilities(
  capabilities: readonly unknown[] | undefined,
): NimiRuntimeLocalRunnableAssetKindId | undefined {
  let resolved: NimiRuntimeLocalRunnableAssetKindId | undefined;
  for (const item of Array.isArray(capabilities) ? capabilities : []) {
    const capability = normalizeLocalVocabularyText(item);
    const kind = CANONICAL_CAPABILITY_TO_ASSET_KIND[capability as keyof typeof CANONICAL_CAPABILITY_TO_ASSET_KIND];
    if (!kind || !isNimiRuntimeLocalRunnableAssetKindId(kind) || (resolved && resolved !== kind)) {
      return undefined;
    }
    resolved = kind;
  }
  return resolved;
}

function normalizeLocalVocabularyText(value: unknown): string {
  return String(value ?? '').trim();
}
