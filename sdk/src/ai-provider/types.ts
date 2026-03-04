import type {
  EmbeddingModelV3,
  ImageModelV3,
  LanguageModelV3,
} from '@ai-sdk/provider';
import type { Runtime, RuntimeCallOptions } from '../runtime/index.js';
import type { AiFallbackPolicy, AiRoutePolicy } from '../types/index.js';

export const ROUTE_POLICY_LOCAL_RUNTIME = 1;
export const ROUTE_POLICY_TOKEN_API = 2;
export const FALLBACK_POLICY_DENY = 1;
export const FALLBACK_POLICY_ALLOW = 2;
export const MODAL_TEXT = 1;
export const MODAL_IMAGE = 2;
export const MODAL_VIDEO = 3;
export const MODAL_TTS = 4;
export const MODAL_STT = 5;
export const MEDIA_JOB_STATUS_COMPLETED = 4;
export const MEDIA_JOB_STATUS_FAILED = 5;
export const MEDIA_JOB_STATUS_CANCELED = 6;
export const MEDIA_JOB_STATUS_TIMEOUT = 7;

export type RuntimeDefaults = {
  appId: string;
  subjectUserId?: string;
  routePolicy: AiRoutePolicy;
  fallback: AiFallbackPolicy;
  timeoutMs?: number;
  metadata?: RuntimeCallOptions['metadata'];
};

export type NimiAiProviderConfig = {
  runtime: Runtime;
  appId: string;
  subjectUserId?: string;
  routePolicy?: AiRoutePolicy;
  fallback?: AiFallbackPolicy;
  timeoutMs?: number;
  metadata?: RuntimeCallOptions['metadata'];
};

export type RuntimeAiBridge = Pick<Runtime['ai'],
  | 'generate'
  | 'streamGenerate'
  | 'embed'
  | 'submitMediaJob'
  | 'getMediaJob'
  | 'cancelMediaJob'
  | 'subscribeMediaJobEvents'
  | 'getMediaResult'
>;

export type RuntimeForAiProvider = {
  ai: RuntimeAiBridge;
};

export type NimiRuntimeVideoModel = {
  generate(options: {
    prompt: string;
    negativePrompt?: string;
    durationSec?: number;
    fps?: number;
    resolution?: string;
    aspectRatio?: string;
    seed?: number;
    firstFrameUri?: string;
    lastFrameUri?: string;
    cameraMotion?: string;
    providerOptions?: Record<string, unknown>;
    requestId?: string;
    idempotencyKey?: string;
    labels?: Record<string, string>;
    routePolicy?: AiRoutePolicy;
    fallback?: AiFallbackPolicy;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<NimiArtifactGenerationResult>;
};

export type NimiRuntimeSpeechModel = {
  synthesize(options: {
    text: string;
    voice?: string;
    language?: string;
    audioFormat?: string;
    sampleRateHz?: number;
    speed?: number;
    pitch?: number;
    volume?: number;
    emotion?: string;
    providerOptions?: Record<string, unknown>;
    requestId?: string;
    idempotencyKey?: string;
    labels?: Record<string, string>;
    routePolicy?: AiRoutePolicy;
    fallback?: AiFallbackPolicy;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<NimiArtifactGenerationResult>;
};

export type NimiRuntimeTranscriptionModel = {
  transcribe(options: {
    audioBytes?: Uint8Array;
    audioUrl?: string;
    audioChunks?: Uint8Array[];
    mimeType?: string;
    language?: string;
    timestamps?: boolean;
    diarization?: boolean;
    speakerCount?: number;
    prompt?: string;
    responseFormat?: string;
    providerOptions?: Record<string, unknown>;
    requestId?: string;
    idempotencyKey?: string;
    labels?: Record<string, string>;
    routePolicy?: AiRoutePolicy;
    fallback?: AiFallbackPolicy;
    timeoutMs?: number;
  }): Promise<{
    text: string;
    traceId: string;
    routeDecision: AiRoutePolicy;
    modelResolved: string;
  }>;
};

export type NimiArtifact = {
  artifactId: string;
  mimeType: string;
  bytes: Uint8Array;
  traceId: string;
  routeDecision: AiRoutePolicy;
  modelResolved: string;
};

export type NimiArtifactGenerationResult = {
  artifacts: NimiArtifact[];
};

export type NimiAiProvider = ((modelId: string) => LanguageModelV3) & {
  text(modelId: string): LanguageModelV3;
  embedding(modelId: string): EmbeddingModelV3;
  image(modelId: string): ImageModelV3;
  video(modelId: string): NimiRuntimeVideoModel;
  tts(modelId: string): NimiRuntimeSpeechModel;
  stt(modelId: string): NimiRuntimeTranscriptionModel;
};
