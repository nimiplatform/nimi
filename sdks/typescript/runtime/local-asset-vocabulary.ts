import {
  LocalAssetKind,
  LocalAssetStatus,
  LocalEngineRuntimeMode,
  LocalProfileEntryKind,
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

export type NimiRuntimeLocalAssetDeclarationLike = {
  readonly assetKind?: NimiRuntimeLocalAssetKindId | string | null;
  readonly engine?: string | null;
};

export type NimiRuntimeLocalAssetDeclaration = {
  readonly assetKind: NimiRuntimeLocalAssetKindId;
  readonly engine?: string;
};

export type NimiRuntimeLocalAssetStatusId = 'installed' | 'active' | 'unhealthy' | 'removed';
export type NimiRuntimeLocalProfileEntryKindId = 'service' | 'node' | 'asset';
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

const NIMI_RUNTIME_LOCAL_ASSET_STATUS_PAIRS = [
  [LocalAssetStatus.INSTALLED, 'installed'],
  [LocalAssetStatus.ACTIVE, 'active'],
  [LocalAssetStatus.UNHEALTHY, 'unhealthy'],
  [LocalAssetStatus.REMOVED, 'removed'],
] as const satisfies readonly (readonly [
  LocalAssetStatus,
  NimiRuntimeLocalAssetStatusId,
])[];

const NIMI_RUNTIME_LOCAL_PROFILE_ENTRY_KIND_PAIRS = [
  [LocalProfileEntryKind.SERVICE, 'service'],
  [LocalProfileEntryKind.NODE, 'node'],
  [LocalProfileEntryKind.ASSET, 'asset'],
] as const satisfies readonly (readonly [
  LocalProfileEntryKind,
  NimiRuntimeLocalProfileEntryKindId,
])[];

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

export const NIMI_RUNTIME_LOCAL_ASSET_STATUS_IDS = Object.freeze(
  NIMI_RUNTIME_LOCAL_ASSET_STATUS_PAIRS.map(([, id]) => id),
) as readonly NimiRuntimeLocalAssetStatusId[];

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

const MANIFEST_TOKEN_TO_CANONICAL_CAPABILITY = {
  chat: 'text.generate',
  vision: 'text.generate.vision',
  audio_chat: 'text.generate.audio',
  video_chat: 'text.generate.video',
  embedding: 'text.embed',
  image: 'image.generate',
  video: 'video.generate',
  tts: 'audio.synthesize',
  stt: 'audio.transcribe',
  music: 'music.generate',
} as const satisfies Record<string, string>;
const MANIFEST_TOKEN_TO_CANONICAL_CAPABILITY_BY_TOKEN =
  MANIFEST_TOKEN_TO_CANONICAL_CAPABILITY as Record<string, string | undefined>;

const CANONICAL_CAPABILITY_TO_ASSET_KIND = {
  'text.generate': 'chat',
  'text.generate.vision': 'chat',
  'text.generate.audio': 'chat',
  'text.generate.video': 'chat',
  'text.embed': 'embedding',
  'image.generate': 'image',
  'image.edit': 'image',
  'video.generate': 'video',
  'audio.synthesize': 'tts',
  'audio.transcribe': 'stt',
  'voice_workflow.voice_clone': 'tts',
  'voice_workflow.voice_design': 'tts',
} as const satisfies Partial<Record<string, NimiRuntimeLocalRunnableAssetKindId>>;

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

export function parseNimiRuntimeLocalAssetStatusId(value: unknown): NimiRuntimeLocalAssetStatusId | undefined {
  const raw = normalizeLocalVocabularyText(value);
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  for (const [protoValue, id] of NIMI_RUNTIME_LOCAL_ASSET_STATUS_PAIRS) {
    if (
      value === protoValue
      || raw === String(protoValue)
      || lower === id
      || lower === `local_asset_status_${id}`
    ) {
      return id;
    }
  }
  return undefined;
}

export function parseNimiRuntimeLocalProfileEntryKindId(
  value: unknown,
): NimiRuntimeLocalProfileEntryKindId | undefined {
  const raw = normalizeLocalVocabularyText(value);
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  for (const [protoValue, id] of NIMI_RUNTIME_LOCAL_PROFILE_ENTRY_KIND_PAIRS) {
    if (
      value === protoValue
      || raw === String(protoValue)
      || lower === id
      || lower === `local_profile_entry_kind_${id}`
    ) {
      return id;
    }
  }
  return undefined;
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

export function toNimiRuntimeLocalAssetStatusRequestValue(value: unknown): LocalAssetStatus {
  const id = parseNimiRuntimeLocalAssetStatusId(value);
  if (!id) {
    return LocalAssetStatus.UNSPECIFIED;
  }
  return NIMI_RUNTIME_LOCAL_ASSET_STATUS_PAIRS.find(([, current]) => current === id)?.[0]
    ?? LocalAssetStatus.UNSPECIFIED;
}

export function toNimiRuntimeLocalProfileEntryKindRequestValue(value: unknown): LocalProfileEntryKind {
  const id = parseNimiRuntimeLocalProfileEntryKindId(value);
  if (!id) {
    return LocalProfileEntryKind.UNSPECIFIED;
  }
  return NIMI_RUNTIME_LOCAL_PROFILE_ENTRY_KIND_PAIRS.find(([, current]) => current === id)?.[0]
    ?? LocalProfileEntryKind.UNSPECIFIED;
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

export function isNimiRuntimeLocalPassiveAssetKindId(
  value: unknown,
): value is NimiRuntimeLocalPassiveAssetKindId {
  const parsed = parseNimiRuntimeLocalAssetKindId(value);
  return Boolean(parsed && (NIMI_RUNTIME_LOCAL_PASSIVE_ASSET_KIND_IDS as readonly string[]).includes(parsed));
}

export function isNimiRuntimeLocalEngineId(value: unknown): value is NimiRuntimeLocalEngineId {
  return parseNimiRuntimeLocalEngineId(value) !== undefined;
}

export function normalizeNimiRuntimeLocalAssetKindId(
  value: unknown,
  fallback: NimiRuntimeLocalAssetKindId = 'chat',
): NimiRuntimeLocalAssetKindId {
  return parseNimiRuntimeLocalAssetKindId(value) ?? fallback;
}

export function normalizeNimiRuntimeLocalRunnableAssetKindId(
  value: unknown,
  fallback: NimiRuntimeLocalRunnableAssetKindId = 'chat',
): NimiRuntimeLocalRunnableAssetKindId {
  return parseNimiRuntimeLocalRunnableAssetKindId(value) ?? fallback;
}

export function normalizeNimiRuntimeLocalPassiveAssetKindId(
  value: unknown,
  fallback: NimiRuntimeLocalPassiveAssetKindId = 'vae',
): NimiRuntimeLocalPassiveAssetKindId {
  const parsed = parseNimiRuntimeLocalAssetKindId(value);
  return parsed && isNimiRuntimeLocalPassiveAssetKindId(parsed) ? parsed : fallback;
}

export function normalizeNimiRuntimeLocalEngineId(
  value: unknown,
  fallback: NimiRuntimeLocalEngineId = 'llama',
): NimiRuntimeLocalEngineId {
  return parseNimiRuntimeLocalEngineId(value) ?? fallback;
}

export function normalizeNimiRuntimeLocalEngineRuntimeModeId(
  value: unknown,
  fallback: NimiRuntimeLocalEngineRuntimeModeId = 'attached-endpoint',
): NimiRuntimeLocalEngineRuntimeModeId {
  return parseNimiRuntimeLocalEngineRuntimeModeId(value) ?? fallback;
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

export function normalizeNimiRuntimeLocalAssetDeclaration(
  declaration?: NimiRuntimeLocalAssetDeclarationLike | null,
  fallback: NimiRuntimeLocalAssetKindId = 'chat',
): NimiRuntimeLocalAssetDeclaration {
  const normalizedKind = normalizeNimiRuntimeLocalAssetKindId(declaration?.assetKind, fallback);
  const engine = normalizeLocalVocabularyText(declaration?.engine);
  return {
    assetKind: normalizedKind,
    ...(engine ? { engine } : {}),
  };
}

export function normalizeNimiRuntimeLocalDependencyAssetDeclaration(
  declaration?: NimiRuntimeLocalAssetDeclarationLike | null,
  fallback: NimiRuntimeLocalPassiveAssetKindId = 'vae',
): NimiRuntimeLocalAssetDeclaration {
  const normalizedKind = normalizeNimiRuntimeLocalPassiveAssetKindId(declaration?.assetKind, fallback);
  const engine = normalizeLocalVocabularyText(declaration?.engine);
  return {
    assetKind: normalizedKind,
    ...(engine ? { engine } : {}),
  };
}

export function canImportNimiRuntimeLocalAssetDeclaration(
  declaration?: NimiRuntimeLocalAssetDeclarationLike | null,
): boolean {
  const assetKind = parseNimiRuntimeLocalAssetKindId(declaration?.assetKind);
  if (!assetKind) {
    return false;
  }
  if (assetKind === 'auxiliary') {
    return Boolean(normalizeLocalVocabularyText(declaration?.engine));
  }
  return true;
}

export function nimiRuntimeCanonicalCapabilityForLocalManifestToken(
  value: unknown,
): string | null {
  const normalized = normalizeLocalVocabularyText(value).toLowerCase();
  return normalized ? (MANIFEST_TOKEN_TO_CANONICAL_CAPABILITY_BY_TOKEN[normalized] || normalized) : null;
}

export function nimiRuntimeLocalCapabilitiesForAssetKind(kind: NimiRuntimeLocalAssetKindId): string[] {
  const parsed = parseNimiRuntimeLocalAssetKindId(kind);
  if (!parsed || !isNimiRuntimeLocalRunnableAssetKindId(parsed)) {
    return [];
  }
  const canonical = nimiRuntimeCanonicalCapabilityForLocalManifestToken(parsed);
  return canonical ? [canonical] : [];
}

export function nimiRuntimeLocalRunnableAssetKindForCapabilities(
  capabilities: readonly unknown[] | undefined,
  fallback: NimiRuntimeLocalRunnableAssetKindId = 'chat',
): NimiRuntimeLocalRunnableAssetKindId {
  const normalized = new Set(
    (Array.isArray(capabilities) ? capabilities : [])
      .map((item) => normalizeLocalVocabularyText(item).toLowerCase())
      .filter(Boolean),
  );
  for (const kind of NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_IDS) {
    if (normalized.has(kind)) {
      return kind;
    }
  }
  for (const [capability, kind] of Object.entries(CANONICAL_CAPABILITY_TO_ASSET_KIND)) {
    if (normalized.has(capability) && isNimiRuntimeLocalRunnableAssetKindId(kind)) {
      return kind;
    }
  }
  return fallback;
}

function normalizeLocalVocabularyText(value: unknown): string {
  return String(value ?? '').trim();
}
