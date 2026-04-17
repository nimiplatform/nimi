import type { HookSourceType, RuntimeHttpContext } from './runtime-hook';
import type { RuntimeHookRuntimeFacade } from './runtime-facade';
import type {
  RuntimeLlmHealthInput,
  RuntimeLlmHealthResult,
  RuntimeRouteHealthResult,
} from './llm';
import type {
  ModRuntimeBoundEmbeddingGenerateInput,
  ModRuntimeLocalProfileSnapshot,
  ModRuntimeBoundImageGenerateInput,
  ModRuntimeBoundWorldGenerateInput,
  ModRuntimeLocalProfile,
  ModRuntimeLocalProfileInstallResult,
  ModRuntimeLocalProfileInstallStatus,
  ModRuntimeListLocalAssetsInput,
  ModRuntimeLocalAssetRecord,
  ModRuntimeProfileEntryOverride,
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
  ScenarioOutput,
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
  RuntimeRouteDescribeResult,
  RuntimeRouteOptionsSnapshot,
  RuntimeRouteResolvedBindingRef,
} from '../runtime-route.js';
import type {
  AIConfig,
  AIConfigProbeResult,
  AISchedulingEvaluationTarget,
  AISchedulingJudgement,
  AIScopeRef,
  AISnapshot,
} from '../runtime/ai-config.js';

export type ModRuntimeHost = {
  checkLocalLlmHealth: (input: RuntimeLlmHealthInput) => Promise<RuntimeLlmHealthResult>;
  getRuntimeHookRuntime: () => RuntimeHookRuntimeFacade;
  getModLocalProfileSnapshot: (input: {
    modId: string;
    capability?: RuntimeCanonicalCapability;
    routeSourceHint?: 'cloud' | 'local';
  }) => Promise<ModRuntimeLocalProfileSnapshot>;
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
    describe: (input: {
      modId: string;
      capability: RuntimeCanonicalCapability;
      resolvedBindingRef: RuntimeRouteResolvedBindingRef;
    }) => Promise<RuntimeRouteDescribeResult>;
  };
  /** K-SCHED-002: Scheduling preflight surface. */
  scheduler: {
    peek: (input: {
      appId: string;
      targets: Array<{
        capability: string;
        modId?: string | null;
        profileId?: string | null;
        resourceHint?: {
          estimatedVramBytes?: number | null;
          estimatedRamBytes?: number | null;
          estimatedDiskBytes?: number | null;
          engine?: string | null;
        } | null;
      }>;
    }) => Promise<{
      occupancy: { globalUsed: number; globalCap: number; appUsed: number; appCap: number } | null;
      aggregateJudgement: {
        state: string;
        detail: string;
        occupancy: { globalUsed: number; globalCap: number; appUsed: number; appCap: number } | null;
        resourceWarnings: string[];
      } | null;
      targetJudgements: Array<{
        target: {
          capability: string;
          modId?: string | null;
          profileId?: string | null;
          resourceHint?: {
            estimatedVramBytes?: number | null;
            estimatedRamBytes?: number | null;
            estimatedDiskBytes?: number | null;
            engine?: string | null;
          } | null;
        };
        judgement: {
          state: string;
          detail: string;
          occupancy: { globalUsed: number; globalCap: number; appUsed: number; appCap: number } | null;
          resourceWarnings: string[];
        };
      }>;
    }>;
  };
  local: {
    listAssets: (input: ModRuntimeListLocalAssetsInput & {
      modId: string;
    }) => Promise<ModRuntimeLocalAssetRecord[]>;
    listProfiles: (input: {
      modId: string;
    }) => Promise<ModRuntimeLocalProfile[]>;
    requestProfileInstall: (input: {
      modId: string;
      profileId: string;
      capability?: RuntimeCanonicalCapability | string;
      confirmMessage?: string;
      entryOverrides?: ModRuntimeProfileEntryOverride[];
    }) => Promise<ModRuntimeLocalProfileInstallResult>;
    getProfileInstallStatus: (input: {
      modId: string;
      profileId: string;
      capability?: RuntimeCanonicalCapability | string;
      entryOverrides?: ModRuntimeProfileEntryOverride[];
    }) => Promise<ModRuntimeLocalProfileInstallStatus>;
  };
  aiConfig: {
    get: (input: { modId: string; scopeRef: AIScopeRef }) => AIConfig;
    update: (input: { modId: string; scopeRef: AIScopeRef; config: AIConfig }) => void;
    listScopes: (input: { modId: string }) => AIScopeRef[];
    probe: (input: { modId: string; scopeRef: AIScopeRef }) => Promise<AIConfigProbeResult>;
    probeFeasibility: (input: { modId: string; scopeRef: AIScopeRef }) => Promise<AIConfigProbeResult>;
    probeSchedulingTarget: (input: {
      modId: string;
      scopeRef: AIScopeRef;
      target: AISchedulingEvaluationTarget;
    }) => Promise<AISchedulingJudgement | null>;
    subscribe: (input: {
      modId: string;
      scopeRef: AIScopeRef;
      callback: (config: AIConfig) => void;
    }) => () => void;
  };
  aiSnapshot: {
    record: (input: { modId: string; scopeRef: AIScopeRef; snapshot: AISnapshot }) => void;
    get: (input: { modId: string; executionId: string }) => AISnapshot | null;
    getLatest: (input: { modId: string; scopeRef: AIScopeRef }) => AISnapshot | null;
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
    world: {
      generate: (input: ModRuntimeBoundWorldGenerateInput & { modId: string }) => Promise<ScenarioJob>;
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
      getArtifacts: (input: { modId: string; jobId: string }) => Promise<{ artifacts: ScenarioArtifact[]; traceId?: string; output?: ScenarioOutput }>;
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
  styleEntryPaths?: string[];
  isDefaultPrivateExecution?: boolean;
  setup: (ctx: RuntimeModLifecycleContext) => Promise<void> | void;
  teardown?: (ctx: RuntimeModLifecycleContext) => Promise<void> | void;
};
