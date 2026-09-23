import {
  CLOUD_ONLY_STUDIO_PARAMETER,
  LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  LOCAL_ONLY_STUDIO_PARAMETER,
  SUPPORTED_STUDIO_PARAMETER,
  UNSUPPORTED_STUDIO_PARAMETER,
  defineStudioParameters,
} from '../../ai-studio-core/parameters.js';

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
  mode?: 't2v' | 'i2v-reference';
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
  requestedPart?: 'vocal-melody' | 'lead-sheet' | 'full-arrangement';
  startSeconds?: number;
  endSeconds?: number;
  recoverySubmissionId?: string;
};

export const studioMusicTranscribeParameters = defineStudioParameters<StudioMusicTranscriptionParameters>({
  initial: () => ({}),
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
    referenceImageArtifactId: LOCAL_ONLY_STUDIO_PARAMETER,
    mask: CLOUD_ONLY_STUDIO_PARAMETER,
  },
});

export const studioVideoGenerateParameters = defineStudioParameters<StudioVideoGenerationParameters>({
  initial: () => ({ mode: 't2v', generateAudio: true }),
  routeMatrix: {
    mode: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    referenceArtifactId: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
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
  initial: () => ({ lyrics: '[Verse]\n\n[Chorus]\n' }),
  routeMatrix: {
    lyrics: LOCAL_AND_CLOUD_STUDIO_PARAMETER, durationSeconds: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    seed: LOCAL_AND_CLOUD_STUDIO_PARAMETER, instrumental: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    returnGeneratedScore: LOCAL_AND_CLOUD_STUDIO_PARAMETER, scoreRelativePath: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    scoreName: LOCAL_AND_CLOUD_STUDIO_PARAMETER, scoreConditioning: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  },
});
