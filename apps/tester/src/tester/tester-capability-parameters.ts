import type { TesterCapabilityId } from './tester-capabilities.js';

export type TesterTextGenerationParameters = {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stop?: string[];
  seed?: number;
};

export type TesterEmbeddingParameters = {
  inputs?: string[];
};

export type TesterImageGenerationParameters = {
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

export type TesterVideoGenerationParameters = {
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

export type TesterSpeechSynthesizeParameters = {
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

export type TesterAudioFile = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
};

export type TesterSpeechTranscribeParameters = {
  audioFile?: TesterAudioFile;
  mimeType?: string;
  language?: string;
  timestamps?: boolean;
  diarization?: boolean;
  speakerCount?: number;
  prompt?: string;
  responseFormat?: string;
};

export type TesterVoiceCreateParameters = {
  creationSource?: 'reference-audio' | 'text-description';
  referenceAudioFile?: TesterAudioFile;
  languageHints?: string;
  preferredName?: string;
  previewText?: string;
  language?: string;
};

export type TesterCapabilityParameterState = {
  'text.generate': TesterTextGenerationParameters;
  'chat.stream': TesterTextGenerationParameters;
  'text.embed': TesterEmbeddingParameters;
  'image.generate': TesterImageGenerationParameters;
  'video.generate': TesterVideoGenerationParameters;
  'audio.synthesize': TesterSpeechSynthesizeParameters;
  'audio.transcribe': TesterSpeechTranscribeParameters;
  'voice.create': TesterVoiceCreateParameters;
  'speech.bundle': Record<string, never>;
  'world.generate': Record<string, never>;
};

export type TesterCapabilityParameters = TesterCapabilityParameterState[TesterCapabilityId];

export const MAX_TESTER_ARTIFACT_UPLOAD_BYTES = 32 * 1024 * 1024;
export const MAX_TESTER_AUDIO_UPLOAD_BYTES = MAX_TESTER_ARTIFACT_UPLOAD_BYTES;
export const MAX_TESTER_VOICE_REFERENCE_AUDIO_BYTES = 20 * 1024 * 1024;

export function createTesterCapabilityParameterState(): TesterCapabilityParameterState {
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

export function summarizeTesterCapabilityParameters(
  capabilityId: TesterCapabilityId,
  parameters: TesterCapabilityParameters,
): Readonly<Record<string, unknown>> {
  if (capabilityId === 'audio.transcribe') {
    const transcribe = parameters as TesterSpeechTranscribeParameters;
    return {
      ...transcribe,
      ...(transcribe.audioFile ? {
        audioFile: `${transcribe.audioFile.name} (${transcribe.audioFile.sizeBytes} bytes)`,
      } : {}),
    };
  }
  if (capabilityId === 'voice.create') {
    const voiceCreate = parameters as TesterVoiceCreateParameters;
    return {
      ...voiceCreate,
      ...(voiceCreate.referenceAudioFile ? {
        referenceAudioFile: `${voiceCreate.referenceAudioFile.name} (${voiceCreate.referenceAudioFile.sizeBytes} bytes)`,
      } : {}),
    };
  }
  return { ...parameters };
}

export function nonEmptyEmbeddingInputs(parameters: TesterEmbeddingParameters | undefined): string[] {
  return (parameters?.inputs ?? []).map((value) => value.trim()).filter(Boolean);
}
