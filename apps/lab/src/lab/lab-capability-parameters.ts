import type { LabCapabilityId } from './lab-capabilities.js';

export type LabTextGenerationParameters = {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stop?: string[];
  seed?: number;
};

export type LabEmbeddingParameters = {
  inputs?: string[];
};

export type LabImageGenerationParameters = {
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

export type LabVideoGenerationParameters = {
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

export type LabSpeechSynthesizeParameters = {
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

export type LabAudioFile = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
};

export type LabSpeechTranscribeParameters = {
  audioFile?: LabAudioFile;
  mimeType?: string;
  language?: string;
  timestamps?: boolean;
  diarization?: boolean;
  speakerCount?: number;
  prompt?: string;
  responseFormat?: string;
};

export type LabVoiceCreateParameters = {
  creationSource?: 'reference-audio' | 'text-description';
  referenceAudioFile?: LabAudioFile;
  languageHints?: string;
  preferredName?: string;
  previewText?: string;
  language?: string;
};

export type LabCapabilityParameterState = {
  'text.generate': LabTextGenerationParameters;
  'chat.stream': LabTextGenerationParameters;
  'text.embed': LabEmbeddingParameters;
  'image.generate': LabImageGenerationParameters;
  'video.generate': LabVideoGenerationParameters;
  'audio.synthesize': LabSpeechSynthesizeParameters;
  'audio.transcribe': LabSpeechTranscribeParameters;
  'voice.create': LabVoiceCreateParameters;
  'speech.bundle': Record<string, never>;
  'world.generate': Record<string, never>;
};

export type LabCapabilityParameters = LabCapabilityParameterState[LabCapabilityId];

export const MAX_LAB_ARTIFACT_UPLOAD_BYTES = 32 * 1024 * 1024;
export const MAX_LAB_AUDIO_UPLOAD_BYTES = MAX_LAB_ARTIFACT_UPLOAD_BYTES;
export const MAX_LAB_VOICE_REFERENCE_AUDIO_BYTES = 20 * 1024 * 1024;

export function createLabCapabilityParameterState(): LabCapabilityParameterState {
  return {
    'text.generate': {},
    'chat.stream': {},
    'text.embed': {},
    'image.generate': {},
    'video.generate': { mode: 't2v', generateAudio: true },
    'audio.synthesize': {},
    'audio.transcribe': {},
    'voice.create': { creationSource: 'text-description' },
    'speech.bundle': {},
    'world.generate': {},
  };
}

export function summarizeLabCapabilityParameters(
  capabilityId: LabCapabilityId,
  parameters: LabCapabilityParameters,
): Readonly<Record<string, unknown>> {
  if (capabilityId === 'audio.transcribe') {
    const transcribe = parameters as LabSpeechTranscribeParameters;
    return {
      ...transcribe,
      ...(transcribe.audioFile ? {
        audioFile: `${transcribe.audioFile.name} (${transcribe.audioFile.sizeBytes} bytes)`,
      } : {}),
    };
  }
  if (capabilityId === 'voice.create') {
    const voiceCreate = parameters as LabVoiceCreateParameters;
    return {
      ...voiceCreate,
      ...(voiceCreate.referenceAudioFile ? {
        referenceAudioFile: `${voiceCreate.referenceAudioFile.name} (${voiceCreate.referenceAudioFile.sizeBytes} bytes)`,
      } : {}),
    };
  }
  return { ...parameters };
}

export function nonEmptyEmbeddingInputs(parameters: LabEmbeddingParameters | undefined): string[] {
  return (parameters?.inputs ?? []).map((value) => value.trim()).filter(Boolean);
}
