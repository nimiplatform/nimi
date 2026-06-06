import {
  ScenarioType,
  SpeechTimingMode,
  VideoContentRole,
  VideoContentType,
  VideoMode,
  type ImageGenerateScenarioSpec,
  type ScenarioSpec,
  type SpeechSynthesizeScenarioSpec,
  type SpeechTranscribeScenarioSpec,
  type SpeechTranscriptionAudioSource,
  type VideoContentItem,
  type VideoGenerateScenarioSpec,
  type VideoGenerationOptions,
  type VoiceReference,
} from '../../core-generated/runtime-typed-client';
import { createNimiError } from '../../types';

export type NimiRuntimeGenerationScenario =
  | {
    readonly kind: 'image';
    readonly prompt: string;
    readonly negativePrompt?: string;
    readonly count?: number;
    readonly size?: string;
    readonly aspectRatio?: string;
    readonly quality?: string;
    readonly style?: string;
    readonly seed?: string | number | bigint;
    readonly referenceImages?: readonly string[];
    readonly mask?: string;
    readonly responseFormat?: string;
  }
  | {
    readonly kind: 'video';
    readonly mode: 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference';
    readonly prompt?: string;
    readonly negativePrompt?: string;
    readonly content?: readonly NimiRuntimeVideoContentPart[];
    readonly options?: NimiRuntimeVideoGenerationOptions;
  }
  | {
    readonly kind: 'speech-synthesize';
    readonly text: string;
    readonly voiceRef?: VoiceReference;
    readonly language?: string;
    readonly audioFormat?: string;
    readonly sampleRateHz?: number;
    readonly speed?: number;
    readonly pitch?: number;
    readonly volume?: number;
    readonly emotion?: string;
    readonly timingMode?: 'unspecified' | 'none' | 'word' | 'char';
  }
  | {
    readonly kind: 'speech-transcribe';
    readonly mimeType: string;
    readonly audio: NimiRuntimeSpeechTranscriptionAudioSource;
    readonly language?: string;
    readonly timestamps?: boolean;
    readonly diarization?: boolean;
    readonly speakerCount?: number;
    readonly prompt?: string;
    readonly responseFormat?: string;
  }
  | {
    readonly kind: 'runtime';
    readonly scenarioType: ScenarioType;
    readonly spec: ScenarioSpec;
  };

export type NimiRuntimeVideoContentPart =
  | {
    readonly type: 'text';
    readonly role?: 'prompt';
    readonly text: string;
  }
  | {
    readonly type: 'image-url';
    readonly role: 'first-frame' | 'last-frame' | 'reference-image';
    readonly url: string;
  }
  | {
    readonly type: 'video-url';
    readonly role: 'reference-video';
    readonly url: string;
  }
  | {
    readonly type: 'audio-url';
    readonly role: 'reference-audio';
    readonly url: string;
  };

export interface NimiRuntimeVideoGenerationOptions {
  readonly resolution?: string;
  readonly ratio?: string;
  readonly durationSec?: number;
  readonly frames?: number;
  readonly fps?: number;
  readonly seed?: string | number | bigint;
  readonly cameraFixed?: boolean;
  readonly watermark?: boolean;
  readonly generateAudio?: boolean;
  readonly draft?: boolean;
  readonly serviceTier?: string;
  readonly executionExpiresAfterSec?: number;
  readonly returnLastFrame?: boolean;
}

export type NimiRuntimeSpeechTranscriptionAudioSource =
  | { readonly type: 'bytes'; readonly bytes: Uint8Array }
  | { readonly type: 'url'; readonly url: string }
  | { readonly type: 'chunks'; readonly chunks: readonly Uint8Array[] };

export function createNimiImageGenerationScenario(
  input: Extract<NimiRuntimeGenerationScenario, { readonly kind: 'image' }>,
): NimiRuntimeGenerationScenario {
  return input;
}

export function createNimiVideoGenerationScenario(
  input: Extract<NimiRuntimeGenerationScenario, { readonly kind: 'video' }>,
): NimiRuntimeGenerationScenario {
  return input;
}

export function createNimiSpeechSynthesisScenario(
  input: Extract<NimiRuntimeGenerationScenario, { readonly kind: 'speech-synthesize' }>,
): NimiRuntimeGenerationScenario {
  return input;
}

export function createNimiSpeechTranscriptionScenario(
  input: Extract<NimiRuntimeGenerationScenario, { readonly kind: 'speech-transcribe' }>,
): NimiRuntimeGenerationScenario {
  return input;
}

export function toRuntimeScenario(scenario: NimiRuntimeGenerationScenario): {
  readonly scenarioType: ScenarioType;
  readonly spec: ScenarioSpec;
} {
  if (scenario.kind === 'runtime') {
    if (scenario.scenarioType === ScenarioType.UNSPECIFIED || scenario.spec.spec.oneofKind === undefined) {
      throw generationScenarioError(
        'SDK_GENERATION_SCENARIO_INVALID',
        'Runtime generation scenario requires an explicit Runtime scenario type and spec',
        'provide_runtime_scenario_spec',
      );
    }
    return { scenarioType: scenario.scenarioType, spec: scenario.spec };
  }
  if (scenario.kind === 'image') {
    return {
      scenarioType: ScenarioType.IMAGE_GENERATE,
      spec: {
        spec: {
          oneofKind: 'imageGenerate',
          imageGenerate: toRuntimeImageGenerationSpec(scenario),
        },
      },
    };
  }
  if (scenario.kind === 'video') {
    return {
      scenarioType: ScenarioType.VIDEO_GENERATE,
      spec: {
        spec: {
          oneofKind: 'videoGenerate',
          videoGenerate: toRuntimeVideoGenerationSpec(scenario),
        },
      },
    };
  }
  if (scenario.kind === 'speech-synthesize') {
    return {
      scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
      spec: {
        spec: {
          oneofKind: 'speechSynthesize',
          speechSynthesize: toRuntimeSpeechSynthesizeSpec(scenario),
        },
      },
    };
  }
  return {
    scenarioType: ScenarioType.SPEECH_TRANSCRIBE,
    spec: {
      spec: {
        oneofKind: 'speechTranscribe',
        speechTranscribe: toRuntimeSpeechTranscribeSpec(scenario),
      },
    },
  };
}

function toRuntimeImageGenerationSpec(
  input: Extract<NimiRuntimeGenerationScenario, { readonly kind: 'image' }>,
): ImageGenerateScenarioSpec {
  return {
    prompt: requireScenarioText(input.prompt, 'image generation prompt is required', 'provide_image_generation_prompt'),
    negativePrompt: normalizeScenarioText(input.negativePrompt),
    n: Number(input.count ?? 1),
    size: normalizeScenarioText(input.size),
    aspectRatio: normalizeScenarioText(input.aspectRatio),
    quality: normalizeScenarioText(input.quality),
    style: normalizeScenarioText(input.style),
    seed: normalizeScenarioInt64(input.seed),
    referenceImages: [...(input.referenceImages ?? [])],
    mask: normalizeScenarioText(input.mask),
    responseFormat: normalizeScenarioText(input.responseFormat),
  };
}

function toRuntimeVideoGenerationSpec(
  input: Extract<NimiRuntimeGenerationScenario, { readonly kind: 'video' }>,
): VideoGenerateScenarioSpec {
  const mode = toRuntimeVideoMode(input.mode);
  const prompt = mode === VideoMode.T2V
    ? requireScenarioText(input.prompt, 'text-to-video generation requires prompt', 'provide_video_generation_prompt')
    : normalizeScenarioText(input.prompt);
  return {
    prompt,
    negativePrompt: normalizeScenarioText(input.negativePrompt),
    mode,
    content: [...(input.content ?? [])].map(toRuntimeVideoContentItem),
    options: toRuntimeVideoGenerationOptions(input.options),
  };
}

function toRuntimeSpeechSynthesizeSpec(
  input: Extract<NimiRuntimeGenerationScenario, { readonly kind: 'speech-synthesize' }>,
): SpeechSynthesizeScenarioSpec {
  return {
    text: requireScenarioText(input.text, 'speech synthesis requires text', 'provide_speech_text'),
    language: normalizeScenarioText(input.language),
    audioFormat: normalizeScenarioText(input.audioFormat),
    sampleRateHz: Number(input.sampleRateHz ?? 0),
    speed: Number(input.speed ?? 0),
    pitch: Number(input.pitch ?? 0),
    volume: Number(input.volume ?? 0),
    emotion: normalizeScenarioText(input.emotion),
    voiceRef: input.voiceRef,
    timingMode: toRuntimeSpeechTimingMode(input.timingMode),
    voiceRenderHints: undefined,
  };
}

function toRuntimeSpeechTranscribeSpec(
  input: Extract<NimiRuntimeGenerationScenario, { readonly kind: 'speech-transcribe' }>,
): SpeechTranscribeScenarioSpec {
  return {
    mimeType: requireScenarioText(input.mimeType, 'speech transcription requires mimeType', 'provide_transcription_mime_type'),
    language: normalizeScenarioText(input.language),
    timestamps: Boolean(input.timestamps),
    diarization: Boolean(input.diarization),
    speakerCount: Number(input.speakerCount ?? 0),
    prompt: normalizeScenarioText(input.prompt),
    audioSource: toRuntimeSpeechTranscriptionAudioSource(input.audio),
    responseFormat: normalizeScenarioText(input.responseFormat),
  };
}

function toRuntimeVideoGenerationOptions(
  input: NimiRuntimeVideoGenerationOptions | undefined,
): VideoGenerationOptions {
  return {
    resolution: normalizeScenarioText(input?.resolution),
    ratio: normalizeScenarioText(input?.ratio),
    durationSec: Number(input?.durationSec ?? 0),
    frames: Number(input?.frames ?? 0),
    fps: Number(input?.fps ?? 0),
    seed: normalizeScenarioInt64(input?.seed),
    cameraFixed: Boolean(input?.cameraFixed),
    watermark: Boolean(input?.watermark),
    generateAudio: Boolean(input?.generateAudio),
    draft: Boolean(input?.draft),
    serviceTier: normalizeScenarioText(input?.serviceTier),
    executionExpiresAfterSec: Number(input?.executionExpiresAfterSec ?? 0),
    returnLastFrame: Boolean(input?.returnLastFrame),
  };
}

function toRuntimeVideoContentItem(input: NimiRuntimeVideoContentPart): VideoContentItem {
  if (input.type === 'text') {
    return {
      type: VideoContentType.TEXT,
      role: toRuntimeVideoContentRole(input.role ?? 'prompt'),
      text: normalizeScenarioText(input.text),
      imageUrl: undefined,
      videoUrl: undefined,
      audioUrl: undefined,
    };
  }
  if (input.type === 'image-url') {
    return {
      type: VideoContentType.IMAGE_URL,
      role: toRuntimeVideoContentRole(input.role),
      text: '',
      imageUrl: { url: ensureSafeExternalUrl(input.url, 'video image url') },
      videoUrl: undefined,
      audioUrl: undefined,
    };
  }
  if (input.type === 'video-url') {
    return {
      type: VideoContentType.VIDEO_URL,
      role: toRuntimeVideoContentRole(input.role),
      text: '',
      imageUrl: undefined,
      videoUrl: { url: ensureSafeExternalUrl(input.url, 'video reference url') },
      audioUrl: undefined,
    };
  }
  return {
    type: VideoContentType.AUDIO_URL,
    role: toRuntimeVideoContentRole(input.role),
    text: '',
    imageUrl: undefined,
    videoUrl: undefined,
    audioUrl: { url: ensureSafeExternalUrl(input.url, 'video audio url') },
  };
}

function toRuntimeSpeechTranscriptionAudioSource(
  input: NimiRuntimeSpeechTranscriptionAudioSource,
): SpeechTranscriptionAudioSource {
  if (input.type === 'bytes') {
    if (!(input.bytes instanceof Uint8Array) || input.bytes.length === 0) {
      throw generationScenarioError('SDK_GENERATION_AUDIO_SOURCE_INVALID', 'speech transcription bytes source is empty', 'provide_audio_bytes');
    }
    return { source: { oneofKind: 'audioBytes', audioBytes: input.bytes } };
  }
  if (input.type === 'chunks') {
    const chunks = input.chunks.filter((chunk): chunk is Uint8Array => chunk instanceof Uint8Array && chunk.length > 0);
    if (chunks.length === 0) {
      throw generationScenarioError('SDK_GENERATION_AUDIO_SOURCE_INVALID', 'speech transcription chunk source is empty', 'provide_audio_chunks');
    }
    return { source: { oneofKind: 'audioChunks', audioChunks: { chunks } } };
  }
  return {
    source: {
      oneofKind: 'audioUri',
      audioUri: ensureSafeExternalUrl(input.url, 'speech transcription audio url'),
    },
  };
}

function toRuntimeVideoMode(mode: Extract<NimiRuntimeGenerationScenario, { readonly kind: 'video' }>['mode']): VideoMode {
  if (mode === 't2v') return VideoMode.T2V;
  if (mode === 'i2v-first-frame') return VideoMode.I2V_FIRST_FRAME;
  if (mode === 'i2v-first-last') return VideoMode.I2V_FIRST_LAST;
  return VideoMode.I2V_REFERENCE;
}

function toRuntimeVideoContentRole(role: NimiRuntimeVideoContentPart['role']): VideoContentRole {
  if (role === 'prompt') return VideoContentRole.PROMPT;
  if (role === 'first-frame') return VideoContentRole.FIRST_FRAME;
  if (role === 'last-frame') return VideoContentRole.LAST_FRAME;
  if (role === 'reference-video') return VideoContentRole.REFERENCE_VIDEO;
  if (role === 'reference-audio') return VideoContentRole.REFERENCE_AUDIO;
  return VideoContentRole.REFERENCE_IMAGE;
}

function toRuntimeSpeechTimingMode(
  mode: Extract<NimiRuntimeGenerationScenario, { readonly kind: 'speech-synthesize' }>['timingMode'],
): SpeechTimingMode {
  if (mode === 'none') return SpeechTimingMode.NONE;
  if (mode === 'word') return SpeechTimingMode.WORD;
  if (mode === 'char') return SpeechTimingMode.CHAR;
  return SpeechTimingMode.UNSPECIFIED;
}

function normalizeScenarioInt64(value: string | number | bigint | undefined): string {
  if (value === undefined || value === null || value === '') {
    return '0';
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) {
    throw generationScenarioError(
      'SDK_GENERATION_INT64_INVALID',
      `Runtime generation int64 field must be an integer string, got ${text}`,
      'provide_integer_generation_value',
    );
  }
  return text;
}

function requireScenarioText(value: unknown, message: string, actionHint: string): string {
  const text = normalizeScenarioText(value);
  if (!text) {
    throw generationScenarioError('SDK_GENERATION_FIELD_REQUIRED', message, actionHint);
  }
  return text;
}

function normalizeScenarioText(value: unknown): string {
  return String(value ?? '').trim();
}

function ensureSafeExternalUrl(value: unknown, label: string): string {
  const text = requireScenarioText(value, `${label} is required`, 'provide_external_media_url');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw generationScenarioError(
      'SDK_GENERATION_URL_INVALID',
      `${label} must be a valid http or https URL`,
      'provide_valid_external_media_url',
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw generationScenarioError(
      'SDK_GENERATION_URL_INVALID',
      `${label} must use http or https`,
      'provide_http_or_https_media_url',
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost'
    || hostname === '0.0.0.0'
    || hostname === '::1'
    || hostname.startsWith('127.')
    || hostname.startsWith('10.')
    || hostname.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./u.test(hostname)
  ) {
    throw generationScenarioError(
      'SDK_GENERATION_URL_UNSAFE',
      `${label} must not target loopback or private network hosts`,
      'provide_public_media_url',
    );
  }
  return url.toString();
}

function generationScenarioError(code: string, message: string, actionHint: string): Error {
  return createNimiError({
    message,
    code,
    reasonCode: code,
    actionHint,
    source: 'sdk',
  });
}
