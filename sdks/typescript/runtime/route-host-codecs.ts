import {
  parseNimiRuntimeLocalAssetKindId,
  type NimiRuntimeLocalRunnableAssetKindId,
} from './local-asset-vocabulary';
import type { NimiRuntimeCanonicalCapability } from './route-options';
import { normalizeNimiRuntimeRouteCapabilityToken } from './route-options';

export type NimiRuntimeRunnableLocalAssetKindId = NimiRuntimeLocalRunnableAssetKindId;

const CAPABILITY_TO_LOCAL_KIND = {
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
} as const satisfies Record<string, NimiRuntimeRunnableLocalAssetKindId>;
const CAPABILITY_TO_LOCAL_KIND_BY_TOKEN = CAPABILITY_TO_LOCAL_KIND as Record<string, NimiRuntimeRunnableLocalAssetKindId | undefined>;

const LOCAL_MANIFEST_TO_CANONICAL_CAPABILITY: Record<string, NimiRuntimeCanonicalCapability> = {
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
};

export function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

export function normalizeLower(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

export function normalizeNimiRuntimeHostRouteCapability(
  value: unknown,
): NimiRuntimeCanonicalCapability | null {
  const normalized = normalizeNimiRuntimeRouteCapabilityToken(value);
  return normalized ? (LOCAL_MANIFEST_TO_CANONICAL_CAPABILITY[normalized] || normalized) : null;
}

export function nimiRuntimeRouteLocalKindForCapability(
  capability: NimiRuntimeCanonicalCapability,
): NimiRuntimeRunnableLocalAssetKindId | null {
  return CAPABILITY_TO_LOCAL_KIND_BY_TOKEN[normalizeNimiRuntimeHostRouteCapability(capability) || ''] || null;
}

export function nimiRuntimeRouteLocalKindSupportsCapability(
  kind: unknown,
  capability: NimiRuntimeCanonicalCapability,
): boolean {
  const parsed = parseNimiRuntimeLocalAssetKindId(kind);
  return Boolean(parsed && parsed === nimiRuntimeRouteLocalKindForCapability(capability));
}

export function nimiRuntimeRouteCapabilitiesMatch(
  capabilities: readonly unknown[] | undefined,
  capability: NimiRuntimeCanonicalCapability,
): boolean {
  return (capabilities || []).some((item) => normalizeNimiRuntimeHostRouteCapability(item) === capability);
}
