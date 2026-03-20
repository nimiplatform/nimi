import type {
  EmbeddingModelV3,
  ImageModelV3,
  LanguageModelV3,
} from '@ai-sdk/provider';
import type { Runtime, RuntimeCallOptions } from '../runtime/index.js';
import type { AiRoutePolicy } from '../types/index.js';

export const ROUTE_POLICY_LOCAL = 1;
export const ROUTE_POLICY_CLOUD = 2;

export type RuntimeDefaults = {
  appId: string;
  subjectUserId?: string;
  routePolicy: AiRoutePolicy;
  timeoutMs?: number;
  metadata?: RuntimeCallOptions['metadata'];
};

export type NimiAiProviderConfig = {
  runtime: Runtime;
  appId?: string;
  subjectUserId?: string;
  routePolicy?: AiRoutePolicy;
  timeoutMs?: number;
  metadata?: RuntimeCallOptions['metadata'];
};

export type RuntimeAiBridge = Pick<Runtime['ai'],
  | 'executeScenario'
  | 'streamScenario'
  | 'submitScenarioJob'
  | 'getScenarioJob'
  | 'cancelScenarioJob'
  | 'subscribeScenarioJobEvents'
  | 'getScenarioArtifacts'
>;

export type RuntimeForAiProvider = {
  ai: RuntimeAiBridge;
};

export type NimiRuntimeVideoModel = {
  generate(options: {
    mode: 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference';
    prompt?: string;
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
    requestId?: string;
    idempotencyKey?: string;
    labels?: Record<string, string>;
    routePolicy?: AiRoutePolicy;
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
    extensions?: Record<string, unknown>;
    requestId?: string;
    idempotencyKey?: string;
    labels?: Record<string, string>;
    routePolicy?: AiRoutePolicy;
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
    extensions?: Record<string, unknown>;
    requestId?: string;
    idempotencyKey?: string;
    labels?: Record<string, string>;
    routePolicy?: AiRoutePolicy;
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
