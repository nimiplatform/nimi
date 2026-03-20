import type { NimiError } from '../types/index.js';
import type { JsonObject } from '../internal/utils.js';
import type {
  ArtifactChunk,
  ScenarioArtifact,
  ScenarioJob,
  ScenarioJobEvent,
  ScenarioOutput,
} from './generated/runtime/v1/ai';

export type NimiRoutePolicy = 'local' | 'cloud';

export type NimiFinishReason =
  | 'stop'
  | 'length'
  | 'content-filter'
  | 'tool-calls'
  | 'error';

export type NimiTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type NimiTraceInfo = {
  traceId?: string;
  modelResolved?: string;
  routeDecision?: NimiRoutePolicy;
};

export type TextMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; imageUrl: string; detail?: 'auto' | 'low' | 'high' }
  | { type: 'video_url'; videoUrl: string }
  | { type: 'audio_url'; audioUrl: string }
  | {
    type: 'artifact_ref';
    artifactId?: string;
    localArtifactId?: string;
    mimeType?: string;
    displayName?: string;
  };

export type TextMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | TextMessageContentPart[];
  name?: string;
};

export type TextGenerateInput = {
  model: string;
  input: string | TextMessage[];
  subjectUserId?: string;
  system?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  route?: NimiRoutePolicy;
  timeoutMs?: number;
  connectorId?: string;
  metadata?: Record<string, string>;
};

export type TextStreamInput = TextGenerateInput & {
  signal?: AbortSignal;
};

export type TextGenerateOutput = {
  text: string;
  finishReason: NimiFinishReason;
  usage: NimiTokenUsage;
  trace: NimiTraceInfo;
};

export type TextStreamPart =
  | { type: 'start' }
  | { type: 'delta'; text: string }
  | { type: 'finish'; finishReason: NimiFinishReason; usage: NimiTokenUsage; trace: NimiTraceInfo }
  | { type: 'error'; error: NimiError };

export type TextStreamOutput = {
  stream: AsyncIterable<TextStreamPart>;
};

export type EmbeddingGenerateInput = {
  model: string;
  input: string | string[];
  subjectUserId?: string;
  route?: NimiRoutePolicy;
  timeoutMs?: number;
  connectorId?: string;
  metadata?: Record<string, string>;
};

export type EmbeddingGenerateOutput = {
  vectors: number[][];
  usage: NimiTokenUsage;
  trace: NimiTraceInfo;
};

export type ImageGenerateInput = {
  model: string;
  prompt: string;
  subjectUserId?: string;
  negativePrompt?: string;
  n?: number;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  style?: string;
  seed?: number;
  referenceImages?: string[];
  mask?: string;
  responseFormat?: 'url' | 'base64';
  extensions?: JsonObject;
  route?: NimiRoutePolicy;
  timeoutMs?: number;
  connectorId?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  signal?: AbortSignal;
};

export type VideoGenerateInput = {
  mode: 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference';
  model: string;
  prompt?: string;
  subjectUserId?: string;
  negativePrompt?: string;
  content: Array<
    | {
      type: 'text';
      role?: 'prompt';
      text: string;
    }
    | {
      type: 'image_url';
      role: 'first_frame' | 'last_frame' | 'reference_image';
      imageUrl: string;
    }
  >;
  options?: {
    resolution?: string;
    ratio?: string;
    durationSec?: number;
    frames?: number;
    fps?: number;
    seed?: number;
    cameraFixed?: boolean;
    watermark?: boolean;
    generateAudio?: boolean;
    draft?: boolean;
    serviceTier?: string;
    executionExpiresAfterSec?: number;
    returnLastFrame?: boolean;
  };
  extensions?: JsonObject;
  route?: NimiRoutePolicy;
  timeoutMs?: number;
  connectorId?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  signal?: AbortSignal;
};

export type SpeechSynthesizeInput = {
  model: string;
  text: string;
  subjectUserId?: string;
  voice?: string;
  language?: string;
  audioFormat?: string;
  sampleRateHz?: number;
  speed?: number;
  pitch?: number;
  volume?: number;
  emotion?: string;
  extensions?: JsonObject;
  timingMode?: 'none' | 'word' | 'char';
  voiceRenderHints?: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    useSpeakerBoost?: boolean;
    speed?: number;
  };
  route?: NimiRoutePolicy;
  timeoutMs?: number;
  connectorId?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  signal?: AbortSignal;
};

export type SpeechTranscribeInput = {
  model: string;
  subjectUserId?: string;
  audio:
    | { kind: 'bytes'; bytes: Uint8Array }
    | { kind: 'url'; url: string }
    | { kind: 'chunks'; chunks: Uint8Array[] };
  mimeType?: string;
  language?: string;
  timestamps?: boolean;
  diarization?: boolean;
  speakerCount?: number;
  prompt?: string;
  responseFormat?: string;
  extensions?: JsonObject;
  route?: NimiRoutePolicy;
  timeoutMs?: number;
  connectorId?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  signal?: AbortSignal;
};

export type ImageGenerateOutput = {
  job: ScenarioJob;
  artifacts: ScenarioArtifact[];
  trace: NimiTraceInfo;
};

export type VideoGenerateOutput = {
  job: ScenarioJob;
  artifacts: ScenarioArtifact[];
  trace: NimiTraceInfo;
};

export type SpeechSynthesizeOutput = {
  job: ScenarioJob;
  artifacts: ScenarioArtifact[];
  trace: NimiTraceInfo;
};

export type SpeechTranscribeOutput = {
  job: ScenarioJob;
  text: string;
  artifacts: ScenarioArtifact[];
  trace: NimiTraceInfo;
};

export type SpeechListVoicesInput = {
  model: string;
  subjectUserId?: string;
  route?: NimiRoutePolicy;
  connectorId?: string;
  metadata?: Record<string, string>;
};

export type SpeechListVoicesOutput = {
  voices: Array<{
    voiceId: string;
    name: string;
    lang: string;
    supportedLangs: string[];
  }>;
  modelResolved: string;
  traceId: string;
  voiceCatalogSource?: string;
  voiceCatalogVersion?: string;
  voiceCount?: number;
};

export type MusicGenerateInput = {
  model: string;
  prompt: string;
  subjectUserId?: string;
  negativePrompt?: string;
  lyrics?: string;
  style?: string;
  title?: string;
  durationSeconds?: number;
  instrumental?: boolean;
  extensions?: JsonObject;
  route?: NimiRoutePolicy;
  timeoutMs?: number;
  connectorId?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  signal?: AbortSignal;
};

export type MusicIterationMode = 'extend' | 'remix' | 'reference';

export type MusicIterationExtensionInput = {
  mode: MusicIterationMode;
  sourceAudioBase64: string;
  sourceMimeType?: string;
  trimStartSec?: number;
  trimEndSec?: number;
};

export type MusicIterateInput = Omit<MusicGenerateInput, 'extensions'> & {
  iteration: MusicIterationExtensionInput;
};

export type MusicGenerateOutput = {
  job: ScenarioJob;
  artifacts: ScenarioArtifact[];
  trace: NimiTraceInfo;
};

export type ScenarioJobSubmitInput =
  | { modal: 'image'; input: ImageGenerateInput }
  | { modal: 'video'; input: VideoGenerateInput }
  | { modal: 'tts'; input: SpeechSynthesizeInput }
  | { modal: 'stt'; input: SpeechTranscribeInput }
  | { modal: 'music'; input: MusicGenerateInput };

export type RuntimeMediaModule = {
  image: {
    generate(input: ImageGenerateInput): Promise<ImageGenerateOutput>;
    stream(input: ImageGenerateInput): Promise<AsyncIterable<ArtifactChunk>>;
  };
  video: {
    generate(input: VideoGenerateInput): Promise<VideoGenerateOutput>;
    stream(input: VideoGenerateInput): Promise<AsyncIterable<ArtifactChunk>>;
  };
  tts: {
    synthesize(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeOutput>;
    stream(input: SpeechSynthesizeInput): Promise<AsyncIterable<ArtifactChunk>>;
    listVoices(input: SpeechListVoicesInput): Promise<SpeechListVoicesOutput>;
  };
  stt: {
    transcribe(input: SpeechTranscribeInput): Promise<SpeechTranscribeOutput>;
  };
  music: {
    generate(input: MusicGenerateInput): Promise<MusicGenerateOutput>;
    iterate(input: MusicIterateInput): Promise<MusicGenerateOutput>;
  };
  jobs: {
    submit(input: ScenarioJobSubmitInput): Promise<ScenarioJob>;
    get(jobId: string): Promise<ScenarioJob>;
    cancel(input: { jobId: string; reason?: string }): Promise<ScenarioJob>;
    subscribe(jobId: string): Promise<AsyncIterable<ScenarioJobEvent>>;
    getArtifacts(jobId: string): Promise<{ artifacts: ScenarioArtifact[]; traceId?: string; output?: ScenarioOutput }>;
  };
};
