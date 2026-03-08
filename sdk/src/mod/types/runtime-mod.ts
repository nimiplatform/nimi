import type { HookSourceType, RuntimeHttpContext } from './runtime-hook';
import type { RuntimeHookRuntimeFacade } from './runtime-facade';
import type {
  RuntimeLlmHealthInput,
  RuntimeLlmHealthResult,
  RuntimeRouteHealthResult,
} from './llm';
import type {
  ModRuntimeBoundEmbeddingGenerateInput,
  ModRuntimeDependencySnapshot,
  ModRuntimeBoundImageGenerateInput,
  ModRuntimeListLocalArtifactsInput,
  ModRuntimeLocalArtifactRecord,
  ModRuntimeBoundSpeechListVoicesInput,
  ModRuntimeBoundSpeechSynthesizeInput,
  ModRuntimeBoundSpeechTranscribeInput,
  ModRuntimeBoundTextGenerateInput,
  ModRuntimeBoundTextStreamInput,
  ModRuntimeBoundVideoGenerateInput,
  ModRuntimeListPresetVoicesInput,
  ModRuntimeResolvedBinding,
  ModRuntimeScenarioJobSubmitInput,
} from '../runtime/types';
import type {
  ArtifactChunk,
  ScenarioArtifact,
  ScenarioJob,
  ScenarioJobEvent,
} from '../../runtime/generated/runtime/v1/ai';
import type {
  DeleteVoiceAssetRequest,
  DeleteVoiceAssetResponse,
  GetVoiceAssetRequest,
  GetVoiceAssetResponse,
  ListPresetVoicesResponse,
  ListVoiceAssetsRequest,
  ListVoiceAssetsResponse,
} from '../../runtime/generated/runtime/v1/voice';
import type {
  EmbeddingGenerateOutput,
  ImageGenerateOutput,
  SpeechListVoicesOutput,
  SpeechSynthesizeOutput,
  SpeechTranscribeOutput,
  TextGenerateOutput,
  TextStreamOutput,
  VideoGenerateOutput,
} from '../../runtime/types';
import type {
  RuntimeCanonicalCapability,
  RuntimeRouteBinding,
  RuntimeRouteOptionsSnapshot,
} from '../runtime-route.js';

export type ModRuntimeHost = {
  checkLocalLlmHealth: (input: RuntimeLlmHealthInput) => Promise<RuntimeLlmHealthResult>;
  getRuntimeHookRuntime: () => RuntimeHookRuntimeFacade;
  getModAiDependencySnapshot: (input: {
    modId: string;
    capability?: RuntimeCanonicalCapability;
    routeSourceHint?: 'cloud' | 'local';
  }) => Promise<ModRuntimeDependencySnapshot>;
  route: {
    listOptions: (input: {
      modId: string;
      capability: RuntimeCanonicalCapability;
    }) => Promise<RuntimeRouteOptionsSnapshot>;
    resolve: (input: {
      modId: string;
      capability: RuntimeCanonicalCapability;
      binding?: RuntimeRouteBinding;
    }) => Promise<ModRuntimeResolvedBinding>;
    checkHealth: (input: {
      modId: string;
      capability: RuntimeCanonicalCapability;
      binding?: RuntimeRouteBinding;
    }) => Promise<RuntimeRouteHealthResult>;
  };
  local: {
    listArtifacts: (input: ModRuntimeListLocalArtifactsInput & {
      modId: string;
    }) => Promise<ModRuntimeLocalArtifactRecord[]>;
  };
  ai: {
    text: {
      generate: (input: ModRuntimeBoundTextGenerateInput & { modId: string }) => Promise<TextGenerateOutput>;
      stream: (input: ModRuntimeBoundTextStreamInput & { modId: string }) => Promise<TextStreamOutput>;
    };
    embedding: {
      generate: (input: ModRuntimeBoundEmbeddingGenerateInput & { modId: string }) => Promise<EmbeddingGenerateOutput>;
    };
  };
  media: {
    image: {
      generate: (input: ModRuntimeBoundImageGenerateInput & { modId: string }) => Promise<ImageGenerateOutput>;
      stream: (input: ModRuntimeBoundImageGenerateInput & { modId: string }) => Promise<AsyncIterable<ArtifactChunk>>;
    };
    video: {
      generate: (input: ModRuntimeBoundVideoGenerateInput & { modId: string }) => Promise<VideoGenerateOutput>;
      stream: (input: ModRuntimeBoundVideoGenerateInput & { modId: string }) => Promise<AsyncIterable<ArtifactChunk>>;
    };
    tts: {
      synthesize: (input: ModRuntimeBoundSpeechSynthesizeInput & { modId: string }) => Promise<SpeechSynthesizeOutput>;
      stream: (input: ModRuntimeBoundSpeechSynthesizeInput & { modId: string }) => Promise<AsyncIterable<ArtifactChunk>>;
      listVoices: (input: ModRuntimeBoundSpeechListVoicesInput & { modId: string }) => Promise<SpeechListVoicesOutput>;
    };
    stt: {
      transcribe: (input: ModRuntimeBoundSpeechTranscribeInput & { modId: string }) => Promise<SpeechTranscribeOutput>;
    };
    jobs: {
      submit: (input: ModRuntimeScenarioJobSubmitInput & { modId: string }) => Promise<ScenarioJob>;
      get: (input: { modId: string; jobId: string }) => Promise<ScenarioJob>;
      cancel: (input: { modId: string; jobId: string; reason?: string }) => Promise<ScenarioJob>;
      subscribe: (input: { modId: string; jobId: string }) => Promise<AsyncIterable<ScenarioJobEvent>>;
      getArtifacts: (input: { modId: string; jobId: string }) => Promise<{ artifacts: ScenarioArtifact[]; traceId?: string }>;
    };
  };
  voice: {
    getAsset: (input: { modId: string; request: GetVoiceAssetRequest }) => Promise<GetVoiceAssetResponse>;
    listAssets: (input: { modId: string; request: ListVoiceAssetsRequest }) => Promise<ListVoiceAssetsResponse>;
    deleteAsset: (input: { modId: string; request: DeleteVoiceAssetRequest }) => Promise<DeleteVoiceAssetResponse>;
    listPresetVoices: (input: ModRuntimeListPresetVoicesInput & { modId: string }) => Promise<ListPresetVoicesResponse>;
  };
};

export type ModRuntimeContext = {
  runtimeHost: ModRuntimeHost;
  runtime: RuntimeHookRuntimeFacade;
};

export type ModRuntimeContextInput = Partial<ModRuntimeContext>;

export type RuntimeModLifecycleContext = {
  kernel: unknown;
  hookRuntime: RuntimeHookRuntimeFacade;
  getHttpContext: () => RuntimeHttpContext;
  sdkRuntimeContext: ModRuntimeContext;
};

export type RuntimeModRegistration = {
  modId: string;
  capabilities: string[];
  grantCapabilities?: string[];
  denialCapabilities?: string[];
  sourceType?: HookSourceType;
  manifestCapabilities?: string[];
  isDefaultPrivateExecution?: boolean;
  setup: (ctx: RuntimeModLifecycleContext) => Promise<void> | void;
  teardown?: (ctx: RuntimeModLifecycleContext) => Promise<void> | void;
};
