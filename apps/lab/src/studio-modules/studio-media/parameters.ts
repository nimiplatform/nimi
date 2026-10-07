import {
  CLOUD_ONLY_STUDIO_PARAMETER,
  LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  LOCAL_ONLY_STUDIO_PARAMETER,
  SUPPORTED_STUDIO_PARAMETER,
  UNSUPPORTED_STUDIO_PARAMETER,
  defineStudioParameters,
} from '../../ai-studio-core/parameters.js';
import type { StudioManagedArtifact } from '../../ai-studio-core/runtime-types.js';

const audioMimeTypes = ['audio/wav', 'audio/mpeg', 'audio/flac'] as const;
const recordedMediaStrings = new Set(['sourceRelativePath', 'sourceName', 'sourceMimeType', 'requestedPart',
  'targetKind', 'targetRelativePath', 'targetName', 'targetMimeType', 'targetPresetVoiceId', 'targetVoiceAssetId']);
const recordedMediaRanges = new Set(['startSeconds', 'endSeconds', 'sourceStartSeconds', 'sourceEndSeconds', 'targetStartSeconds', 'targetEndSeconds']);

function restoreMediaControls(snapshot: Readonly<Record<string, unknown>>): Record<string, unknown> | null {
  const restored: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined || key === 'recoverySubmissionId') continue;
    if (recordedMediaStrings.has(key)) {
      if (typeof value !== 'string') return null;
    } else if (recordedMediaRanges.has(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    } else if (key === 'semitoneShift') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < -12 || value > 12) return null;
    } else if (key === 'includeInstrumentParts') {
      if (typeof value !== 'boolean') return null;
    } else if (key === 'requestedFormats') {
      if (!Array.isArray(value) || !value.length || value.some(item => !['abc', 'midi', 'timeline'].includes(String(item)))) return null;
    } else return null;
    restored[key] = Array.isArray(value) ? [...value] : value;
  }
  return restored;
}

function restoreAudioReference(restored: Record<string, unknown>, role: 'source' | 'target', saved?: StudioManagedArtifact): boolean {
  const path = saved?.relativePath ?? restored[`${role}RelativePath`];
  const mime = saved?.mediaType ?? restored[`${role}MimeType`];
  if (typeof path !== 'string' || !path.trim() || !audioMimeTypes.includes(mime as typeof audioMimeTypes[number])) return false;
  restored[`${role}RelativePath`] = path;
  restored[`${role}MimeType`] = mime;
  const name = saved?.displayName ?? restored[`${role}Name`];
  if (typeof name === 'string') restored[`${role}Name`] = name;
  return true;
}

function recordedRangeValid(restored: Record<string, unknown>, start: string, end: string): boolean {
  return restored[end] === undefined || Number(restored[end]) > Number(restored[start] ?? 0);
}

export type StudioImageGenerationParameters = {
  negativePrompt?: string;
  count?: number;
  size?: string;
  seed?: number;
  aspectRatio?: string;
  quality?: string;
  style?: string;
  referenceImage?: string;
  referenceImageArtifactId?: string;
  mask?: string;
};

export type StudioVideoGenerationParameters = {
  mode?: 't2v' | 'i2v-first-frame' | 'i2v-reference';
  firstFrameImageUrl?: string;
  referenceArtifactId?: string;
  negativePrompt?: string;
  resolution?: string;
  frames?: number;
  seed?: number;
  generateAudio?: boolean;
  ratio?: string;
  durationSec?: number;
  fps?: number;
  cameraFixed?: boolean;
  watermark?: boolean;
  draft?: boolean;
  returnLastFrame?: boolean;
  serviceTier?: string;
  executionExpiresAfterSec?: number;
};

export type StudioMusicGenerationParameters = {
  lyrics?: string;
  durationSeconds?: number;
  seed?: number;
  instrumental?: boolean;
  returnGeneratedScore?: boolean;
  scoreRelativePath?: string;
  scoreName?: string;
  recoverySubmissionId?: string;
  scoreConditioning?: 'melody-only' | 'melody-and-harmony';
};

export type StudioMusicTranscriptionParameters = {
  sourceRelativePath?: string;
  sourceName?: string;
  sourceMimeType?: 'audio/wav' | 'audio/mpeg' | 'audio/flac';
  requestedFormats?: ('abc' | 'midi' | 'timeline')[];
  requestedPart?: 'vocal-melody' | 'lead-sheet' | 'full-arrangement' | 'note-events';
  startSeconds?: number;
  endSeconds?: number;
  recoverySubmissionId?: string;
};

export const studioMusicTranscribeParameters = defineStudioParameters<StudioMusicTranscriptionParameters>({
  initial: () => ({}),
  restoreRecordedParameters: (snapshot, result) => {
    if (!snapshot) return null;
    const restored = restoreMediaControls(snapshot);
    const saved = result?.ok && result.kind === 'artifacts' ? result.musicTranscription?.sourceAudio : undefined;
    if (!restored || !restoreAudioReference(restored, 'source', saved)) return null;
    if (!['vocal-melody', 'lead-sheet', 'full-arrangement', 'note-events'].includes(String(restored.requestedPart))
      || !Array.isArray(restored.requestedFormats) || !restored.requestedFormats.length
      || !recordedRangeValid(restored, 'startSeconds', 'endSeconds')) return null;
    return restored as StudioMusicTranscriptionParameters;
  },
  hasAlternativeInput: (value) => Boolean(value.sourceRelativePath || value.recoverySubmissionId),
  routeMatrix: Object.fromEntries(['sourceRelativePath', 'sourceName', 'sourceMimeType', 'requestedFormats', 'requestedPart', 'startSeconds', 'endSeconds', 'recoverySubmissionId'].map(key => [key, LOCAL_ONLY_STUDIO_PARAMETER])),
});

export type StudioVoiceConvertParameters = {
  sourceRelativePath?: string;
  sourceName?: string;
  sourceMimeType?: 'audio/wav' | 'audio/mpeg' | 'audio/flac';
  sourceStartSeconds?: number;
  sourceEndSeconds?: number;
  targetKind?: 'reference-audio' | 'preset' | 'voice-asset';
  targetRelativePath?: string;
  targetName?: string;
  targetMimeType?: 'audio/wav' | 'audio/mpeg' | 'audio/flac';
  targetStartSeconds?: number;
  targetEndSeconds?: number;
  targetPresetVoiceId?: string;
  targetVoiceAssetId?: string;
  semitoneShift?: number;
  recoverySubmissionId?: string;
};

function voiceConvertTargetReady(value: StudioVoiceConvertParameters): boolean {
  if (value.targetKind === 'preset') return Boolean(value.targetPresetVoiceId?.trim());
  if (value.targetKind === 'voice-asset') return Boolean(value.targetVoiceAssetId?.trim());
  return value.targetKind === 'reference-audio' ? Boolean(value.targetRelativePath && value.targetMimeType) : false;
}

export const studioVoiceConvertParameters = defineStudioParameters<StudioVoiceConvertParameters>({
  initial: () => ({}),
  restoreRecordedParameters: (snapshot, result) => {
    if (!snapshot) return null;
    const restored = restoreMediaControls(snapshot);
    const saved = result?.ok && result.kind === 'artifacts' ? result.voiceConversion : undefined;
    if (!restored || !restoreAudioReference(restored, 'source', saved?.sourceVocal)) return null;
    if (saved?.targetVoice || restored.targetKind === 'reference-audio') {
      if (!restoreAudioReference(restored, 'target', saved?.targetVoice)) return null;
      restored.targetKind = 'reference-audio';
    } else if (restored.targetKind === 'preset') {
      if (typeof restored.targetPresetVoiceId !== 'string' || !restored.targetPresetVoiceId.trim()) return null;
    } else if (restored.targetKind === 'voice-asset') {
      if (typeof restored.targetVoiceAssetId !== 'string' || !restored.targetVoiceAssetId.trim()) return null;
    } else return null;
    if (!recordedRangeValid(restored, 'sourceStartSeconds', 'sourceEndSeconds')
      || !recordedRangeValid(restored, 'targetStartSeconds', 'targetEndSeconds')) return null;
    return restored as StudioVoiceConvertParameters;
  },
  hasAlternativeInput: (value) => Boolean(value.recoverySubmissionId
    || (value.sourceRelativePath && value.sourceMimeType && voiceConvertTargetReady(value))),
  routeMatrix: Object.fromEntries(['sourceRelativePath', 'sourceName', 'sourceMimeType', 'sourceStartSeconds', 'sourceEndSeconds',
    'targetKind', 'targetRelativePath', 'targetName', 'targetMimeType', 'targetStartSeconds', 'targetEndSeconds',
    'targetPresetVoiceId', 'targetVoiceAssetId', 'semitoneShift', 'recoverySubmissionId'].map(key => [key, LOCAL_ONLY_STUDIO_PARAMETER])),
});

export type StudioAudioSeparateParameters = {
  sourceRelativePath?: string;
  sourceName?: string;
  sourceMimeType?: 'audio/wav' | 'audio/mpeg' | 'audio/flac';
  startSeconds?: number;
  endSeconds?: number;
  includeInstrumentParts?: boolean;
  recoverySubmissionId?: string;
};

export const studioAudioSeparateParameters = defineStudioParameters<StudioAudioSeparateParameters>({
  initial: () => ({}),
  restoreRecordedParameters: (snapshot, result) => {
    const saved = result?.ok && result.kind === 'artifacts' ? result.audioSeparation : undefined;
    // A saved separation request itself records full-source versus range.
    // Without it, absent request context cannot be treated as empty controls.
    if (!snapshot && !saved?.request) return null;
    const restored = restoreMediaControls(snapshot ?? {});
    if (!restored || !restoreAudioReference(restored, 'source', saved?.sourceAudio)) return null;
    if (restored.startSeconds === undefined && restored.endSeconds === undefined && saved?.request?.kind === 'range') {
      restored.startSeconds = saved.request.startSeconds;
      if (saved.request.endSeconds !== undefined) restored.endSeconds = saved.request.endSeconds;
    }
    if (!recordedRangeValid(restored, 'startSeconds', 'endSeconds')) return null;
    return restored as StudioAudioSeparateParameters;
  },
  hasAlternativeInput: (value) => Boolean(value.sourceRelativePath || value.recoverySubmissionId),
  routeMatrix: Object.fromEntries(['sourceRelativePath', 'sourceName', 'sourceMimeType', 'startSeconds', 'endSeconds',
    'includeInstrumentParts', 'recoverySubmissionId'].map(key => [key, LOCAL_ONLY_STUDIO_PARAMETER])),
});

const LOCAL_APP_UNAVAILABLE = Object.freeze({
  local: UNSUPPORTED_STUDIO_PARAMETER,
  cloud: UNSUPPORTED_STUDIO_PARAMETER,
});

export const MAX_STUDIO_ARTIFACT_UPLOAD_BYTES = 32 * 1024 * 1024;

export const studioImageGenerateParameters = defineStudioParameters<StudioImageGenerationParameters>({
  initial: () => ({}),
  routeMatrix: {
    negativePrompt: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    count: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    size: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    seed: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    aspectRatio: CLOUD_ONLY_STUDIO_PARAMETER,
    quality: CLOUD_ONLY_STUDIO_PARAMETER,
    style: CLOUD_ONLY_STUDIO_PARAMETER,
    referenceImage: CLOUD_ONLY_STUDIO_PARAMETER,
    referenceImageArtifactId: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    mask: CLOUD_ONLY_STUDIO_PARAMETER,
  },
});

export const studioVideoGenerateParameters = defineStudioParameters<StudioVideoGenerationParameters>({
	initial: () => ({ mode: 't2v' }),
  routeMatrix: {
    mode: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    referenceArtifactId: LOCAL_ONLY_STUDIO_PARAMETER,
    firstFrameImageUrl: CLOUD_ONLY_STUDIO_PARAMETER,
    negativePrompt: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    resolution: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    frames: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    seed: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    generateAudio: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    ratio: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    durationSec: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    fps: { local: { kind: 'fixed', value: 24 }, cloud: SUPPORTED_STUDIO_PARAMETER },
    cameraFixed: CLOUD_ONLY_STUDIO_PARAMETER,
    watermark: CLOUD_ONLY_STUDIO_PARAMETER,
    draft: CLOUD_ONLY_STUDIO_PARAMETER,
    returnLastFrame: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    serviceTier: LOCAL_APP_UNAVAILABLE,
    executionExpiresAfterSec: LOCAL_APP_UNAVAILABLE,
  },
});

export const studioMusicGenerateParameters = defineStudioParameters<StudioMusicGenerationParameters>({
  initial: () => ({}),
  routeMatrix: {
    lyrics: LOCAL_AND_CLOUD_STUDIO_PARAMETER, durationSeconds: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    seed: LOCAL_AND_CLOUD_STUDIO_PARAMETER, instrumental: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    returnGeneratedScore: LOCAL_AND_CLOUD_STUDIO_PARAMETER, scoreRelativePath: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    scoreName: LOCAL_AND_CLOUD_STUDIO_PARAMETER, scoreConditioning: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  },
});
