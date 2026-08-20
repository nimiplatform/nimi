import {
  CLOUD_ONLY_STUDIO_PARAMETER,
  LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  SUPPORTED_STUDIO_PARAMETER,
  defineStudioParameters,
} from '../../ai-studio-core/parameters.js';

export type StudioSpeechSynthesizeParameters = {
  voiceKind?: 'preset' | 'asset';
  voicePreset?: string;
  voiceAssetId?: string;
  language?: string;
  audioFormat?: string;
  sampleRateHz?: number;
  speed?: number;
  pitch?: number;
  volume?: number;
  emotion?: string;
  timingMode?: 'unspecified' | 'none' | 'word' | 'char';
};

export type StudioAudioFile = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
};

export type StudioSpeechTranscribeParameters = {
  audioFile?: StudioAudioFile;
  mimeType?: string;
  language?: string;
  timestamps?: boolean;
  diarization?: boolean;
  speakerCount?: number;
  prompt?: string;
  responseFormat?: string;
};

export type StudioVoiceCreateParameters = {
  creationSource?: 'reference-audio' | 'text-description';
  referenceAudioFile?: StudioAudioFile;
  languageHints?: string;
  preferredName?: string;
  previewText?: string;
  language?: string;
};

export const MAX_STUDIO_AUDIO_UPLOAD_BYTES = 32 * 1024 * 1024;
export const MAX_STUDIO_VOICE_REFERENCE_AUDIO_BYTES = 20 * 1024 * 1024;

const LOCAL_PRESET_CLOUD_CONFIGURABLE = Object.freeze({
  local: { kind: 'fixed', value: 'preset' } as const,
  cloud: SUPPORTED_STUDIO_PARAMETER,
});
const LOCAL_TEXT_CLOUD_CONFIGURABLE = Object.freeze({
  local: { kind: 'fixed', value: 'text' } as const,
  cloud: SUPPORTED_STUDIO_PARAMETER,
});

export const studioSpeechSynthesizeParameters = defineStudioParameters<StudioSpeechSynthesizeParameters>({
  initial: () => ({}),
  routeMatrix: {
    voiceKind: LOCAL_PRESET_CLOUD_CONFIGURABLE,
    voicePreset: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    voiceAssetId: CLOUD_ONLY_STUDIO_PARAMETER,
    language: CLOUD_ONLY_STUDIO_PARAMETER,
    audioFormat: CLOUD_ONLY_STUDIO_PARAMETER,
    sampleRateHz: CLOUD_ONLY_STUDIO_PARAMETER,
    speed: CLOUD_ONLY_STUDIO_PARAMETER,
    pitch: CLOUD_ONLY_STUDIO_PARAMETER,
    volume: CLOUD_ONLY_STUDIO_PARAMETER,
    emotion: CLOUD_ONLY_STUDIO_PARAMETER,
    timingMode: CLOUD_ONLY_STUDIO_PARAMETER,
  },
});

export const studioSpeechTranscribeParameters = defineStudioParameters<StudioSpeechTranscribeParameters>({
  initial: () => ({}),
  routeMatrix: {
    audioFile: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    mimeType: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    language: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    timestamps: CLOUD_ONLY_STUDIO_PARAMETER,
    diarization: CLOUD_ONLY_STUDIO_PARAMETER,
    speakerCount: CLOUD_ONLY_STUDIO_PARAMETER,
    prompt: CLOUD_ONLY_STUDIO_PARAMETER,
    responseFormat: LOCAL_TEXT_CLOUD_CONFIGURABLE,
  },
  summarize: (parameters) => ({
    ...parameters,
    ...(parameters.audioFile ? {
      audioFile: `${parameters.audioFile.name} (${parameters.audioFile.sizeBytes} bytes)`,
    } : {}),
  }),
  hasAlternativeInput: (parameters) => Boolean(parameters.audioFile),
});

export const studioVoiceCreateParameters = defineStudioParameters<StudioVoiceCreateParameters>({
  initial: () => ({ creationSource: 'text-description' }),
  routeMatrix: {
    creationSource: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    referenceAudioFile: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    languageHints: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    preferredName: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    previewText: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    language: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  },
  summarize: (parameters) => ({
    ...parameters,
    ...(parameters.referenceAudioFile ? {
      referenceAudioFile: `${parameters.referenceAudioFile.name} (${parameters.referenceAudioFile.sizeBytes} bytes)`,
    } : {}),
  }),
  hasAlternativeInput: (parameters) => Boolean(parameters.referenceAudioFile),
});
