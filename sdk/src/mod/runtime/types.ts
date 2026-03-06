import type {
  DeleteVoiceAssetRequest,
  DeleteVoiceAssetResponse,
  GetVoiceAssetRequest,
  GetVoiceAssetResponse,
  ListPresetVoicesRequest,
  ListPresetVoicesResponse,
  ListVoiceAssetsRequest,
  ListVoiceAssetsResponse,
} from '../../runtime/generated/runtime/v1/voice.js';
import type {
  ArtifactChunk,
  ScenarioArtifact,
  ScenarioJob,
  ScenarioJobEvent,
} from '../../runtime/generated/runtime/v1/ai.js';
import type {
  EmbeddingGenerateInput,
  EmbeddingGenerateOutput,
  ImageGenerateInput,
  ImageGenerateOutput,
  SpeechListVoicesInput,
  SpeechListVoicesOutput,
  SpeechSynthesizeInput,
  SpeechSynthesizeOutput,
  SpeechTranscribeInput,
  SpeechTranscribeOutput,
  TextGenerateInput,
  TextGenerateOutput,
  TextStreamInput,
  TextStreamOutput,
  VideoGenerateInput,
  VideoGenerateOutput,
} from '../../runtime/types.js';
import type {
  RuntimeCanonicalCapability,
  RuntimeRouteBinding,
  RuntimeRouteOptionsSnapshot,
  RuntimeRouteSource,
} from '../runtime-route.js';
import type { RuntimeRouteHealthResult } from '../types/llm.js';

export type ModRuntimeResolvedBinding = {
  capability: RuntimeCanonicalCapability;
  source: RuntimeRouteSource;
  provider: string;
  model: string;
  connectorId: string;
  endpoint?: string;
  localModelId?: string;
  engine?: string;
  adapter?: string;
  localProviderEndpoint?: string;
  localOpenAiEndpoint?: string;
};

export type ModRuntimeRouteListOptionsInput = {
  capability: RuntimeCanonicalCapability;
};

export type ModRuntimeRouteResolveInput = {
  capability: RuntimeCanonicalCapability;
  binding?: RuntimeRouteBinding;
};

export type ModRuntimeRouteCheckHealthInput = ModRuntimeRouteResolveInput;

export type ModRuntimeBoundTextGenerateInput =
  Omit<TextGenerateInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeBoundTextStreamInput =
  Omit<TextStreamInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeBoundEmbeddingGenerateInput =
  Omit<EmbeddingGenerateInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeBoundImageGenerateInput =
  Omit<ImageGenerateInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeBoundVideoGenerateInput =
  Omit<VideoGenerateInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeBoundSpeechSynthesizeInput =
  Omit<SpeechSynthesizeInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeBoundSpeechTranscribeInput =
  Omit<SpeechTranscribeInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeBoundSpeechListVoicesInput =
  Omit<SpeechListVoicesInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeListPresetVoicesInput =
  Omit<ListPresetVoicesRequest, 'modelId' | 'connectorId'>
  & {
    modelId?: string;
    connectorId?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeClient = {
  route: {
    listOptions(input: ModRuntimeRouteListOptionsInput): Promise<RuntimeRouteOptionsSnapshot>;
    resolve(input: ModRuntimeRouteResolveInput): Promise<ModRuntimeResolvedBinding>;
    checkHealth(input: ModRuntimeRouteCheckHealthInput): Promise<RuntimeRouteHealthResult>;
  };
  ai: {
    text: {
      generate(input: ModRuntimeBoundTextGenerateInput): Promise<TextGenerateOutput>;
      stream(input: ModRuntimeBoundTextStreamInput): Promise<TextStreamOutput>;
    };
    embedding: {
      generate(input: ModRuntimeBoundEmbeddingGenerateInput): Promise<EmbeddingGenerateOutput>;
    };
  };
  media: {
    image: {
      generate(input: ModRuntimeBoundImageGenerateInput): Promise<ImageGenerateOutput>;
      stream(input: ModRuntimeBoundImageGenerateInput): Promise<AsyncIterable<ArtifactChunk>>;
    };
    video: {
      generate(input: ModRuntimeBoundVideoGenerateInput): Promise<VideoGenerateOutput>;
      stream(input: ModRuntimeBoundVideoGenerateInput): Promise<AsyncIterable<ArtifactChunk>>;
    };
    tts: {
      synthesize(input: ModRuntimeBoundSpeechSynthesizeInput): Promise<SpeechSynthesizeOutput>;
      stream(input: ModRuntimeBoundSpeechSynthesizeInput): Promise<AsyncIterable<ArtifactChunk>>;
      listVoices(input: ModRuntimeBoundSpeechListVoicesInput): Promise<SpeechListVoicesOutput>;
    };
    stt: {
      transcribe(input: ModRuntimeBoundSpeechTranscribeInput): Promise<SpeechTranscribeOutput>;
    };
    jobs: {
      get(jobId: string): Promise<ScenarioJob>;
      cancel(input: { jobId: string; reason?: string }): Promise<ScenarioJob>;
      subscribe(jobId: string): Promise<AsyncIterable<ScenarioJobEvent>>;
      getArtifacts(jobId: string): Promise<{ artifacts: ScenarioArtifact[]; traceId?: string }>;
    };
  };
  voice: {
    getAsset(request: GetVoiceAssetRequest): Promise<GetVoiceAssetResponse>;
    listAssets(request: ListVoiceAssetsRequest): Promise<ListVoiceAssetsResponse>;
    deleteAsset(request: DeleteVoiceAssetRequest): Promise<DeleteVoiceAssetResponse>;
    listPresetVoices(input: ModRuntimeListPresetVoicesInput): Promise<ListPresetVoicesResponse>;
  };
};

export type ModRuntimeDependencyEntry = {
  dependencyId: string;
  kind: 'model' | 'service' | 'node';
  capability?: string;
  required: boolean;
  selected: boolean;
  preferred: boolean;
  modelId?: string;
  repo?: string;
  engine?: string;
  serviceId?: string;
  nodeId?: string;
  reasonCode?: string;
  warnings: string[];
};

export type ModRuntimeRepairAction = {
  actionId: string;
  label: string;
  reasonCode: string;
  dependencyId?: string;
  capability?: string;
};

export type ModRuntimeDependencySnapshot = {
  modId: string;
  planId?: string;
  status: 'ready' | 'missing' | 'degraded';
  routeSource: 'local-runtime' | 'token-api' | 'mixed' | 'unknown';
  reasonCode?: string;
  warnings: string[];
  dependencies: ModRuntimeDependencyEntry[];
  repairActions: ModRuntimeRepairAction[];
  updatedAt: string;
};

export type ModRuntimeInspector = {
  getDependencySnapshot: (
    capability?: string,
    routeSourceHint?: 'token-api' | 'local-runtime',
  ) => Promise<ModRuntimeDependencySnapshot>;
  getRepairActions: (capability?: string) => Promise<ModRuntimeRepairAction[]>;
};
