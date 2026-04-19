import type { ComponentType, ReactNode } from 'react';
import type { JsonObject } from '../../internal/utils.js';
import type {
  RuntimeHttpContext,
} from '../types/runtime-hook.js';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-facade.js';
import type {
  RuntimeLlmHealthInput,
  RuntimeLlmHealthResult,
  RuntimeRouteHealthResult,
} from '../types/llm.js';
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
} from '../runtime/types.js';
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
  MemoryEmbeddingBindResult,
  MemoryEmbeddingConfig,
  MemoryEmbeddingCutoverResult,
  MemoryEmbeddingRuntimeInput,
  MemoryEmbeddingRuntimeState,
} from '../runtime/ai-config.js';
import type {
  WorldEvolutionCheckpointSelector,
  WorldEvolutionCheckpointView,
  WorldEvolutionCommitRequestSelector,
  WorldEvolutionCommitRequestView,
  WorldEvolutionExecutionEventSelector,
  WorldEvolutionExecutionEventView,
  WorldEvolutionReplaySelector,
  WorldEvolutionReplayView,
  WorldEvolutionSupervisionSelector,
  WorldEvolutionSupervisionView,
} from '../../runtime/world-evolution-selector-read.js';

export type RuntimeLogMessage = {
  level: 'debug' | 'info' | 'warn' | 'error';
  area: string;
  message: string;
  traceId?: string;
  flowId?: string;
  source?: string;
  costMs?: number;
  details?: JsonObject;
};

export type RendererLogMessage = {
  level?: 'debug' | 'info' | 'warn' | 'error';
  area: string;
  message: string;
  flowId?: string;
  source?: string;
  costMs?: number;
  details?: JsonObject;
};

export type ModSdkUiContext = {
  isAuthenticated: boolean;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  runtimeFields: Record<string, string | number | boolean>;
  setRuntimeFields: (fields: Record<string, string | number | boolean>) => void;
};

export type ModShellStatusBannerInput = {
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export type ModShellAuthState = {
  isAuthenticated: boolean;
  user: JsonObject | null;
};

export type ModShellBootstrapState = {
  ready: boolean;
  error: string | null;
};

export type ModShellNavigationState = {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  navigateToProfile: (profileId: string | null, tab: 'profile' | 'agent-detail') => void;
};

export type ModShellRuntimeFieldsState = {
  runtimeFields: Record<string, string | number | boolean>;
  setRuntimeField: (field: string, value: string | number | boolean) => void;
  setRuntimeFields: (fields: Record<string, string | number | boolean>) => void;
};

export type ModShellStatusBannerState = {
  showStatusBanner: (input: ModShellStatusBannerInput) => void;
};

export type RuntimeKernelTurnInput = {
  requestId: string;
  sessionId: string;
  turnIndex: number;
  mode?: 'STORY' | 'SCENE_TURN' | string;
  userInputText: string;
  provider?: string;
  worldId?: string;
  agentId?: string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
  extra?: JsonObject;
};

export type RuntimeKernelTurnResult = {
  text?: string;
  traceId?: string;
  promptTraceId?: string;
  latencyMs?: number;
  provider?: string;
  detail?: string;
  error?: string;
  [key: string]: unknown;
};

export type ModLifecycleState =
  | 'active'
  | 'background-throttled'
  | 'frozen'
  | 'discarded';

export type ModWorldEvolutionHost = {
  executionEvents: {
    read: (selector: WorldEvolutionExecutionEventSelector) => Promise<WorldEvolutionExecutionEventView[]>;
  };
  replays: {
    read: (selector: WorldEvolutionReplaySelector) => Promise<WorldEvolutionReplayView[]>;
  };
  checkpoints: {
    read: (selector: WorldEvolutionCheckpointSelector) => Promise<WorldEvolutionCheckpointView[]>;
  };
  supervision: {
    read: (selector: WorldEvolutionSupervisionSelector) => Promise<WorldEvolutionSupervisionView[]>;
  };
  commitRequests: {
    read: (selector: WorldEvolutionCommitRequestSelector) => Promise<WorldEvolutionCommitRequestView[]>;
  };
};

export type ModSdkHost = {
  worldEvolution: ModWorldEvolutionHost;
  runtime: {
    checkLocalLlmHealth: (input: RuntimeLlmHealthInput) => Promise<RuntimeLlmHealthResult>;
    executeLocalKernelTurn: (input: RuntimeKernelTurnInput) => Promise<RuntimeKernelTurnResult>;
    withOpenApiContextLock: <T>(
      context: RuntimeHttpContext,
      task: () => Promise<T>,
    ) => Promise<T>;
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
  memoryEmbeddingConfig: {
    get: (input: { modId: string; scopeRef: AIScopeRef }) => MemoryEmbeddingConfig;
    update: (input: { modId: string; scopeRef: AIScopeRef; config: MemoryEmbeddingConfig }) => void;
    subscribe: (input: {
      modId: string;
      scopeRef: AIScopeRef;
      callback: (config: MemoryEmbeddingConfig) => void;
    }) => () => void;
  };
  memoryEmbeddingRuntime: {
    inspect: (input: { modId: string; request: MemoryEmbeddingRuntimeInput }) => Promise<MemoryEmbeddingRuntimeState>;
    requestBind: (input: { modId: string; request: MemoryEmbeddingRuntimeInput }) => Promise<MemoryEmbeddingBindResult>;
    requestCutover: (input: { modId: string; request: MemoryEmbeddingRuntimeInput }) => Promise<MemoryEmbeddingCutoverResult>;
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
  ui: {
    useAppStore: <T>(selector: (state: unknown) => T) => T;
    SlotHost: ComponentType<{
      slot: string;
      base: ReactNode;
      context: ModSdkUiContext;
    }>;
    useUiExtensionContext: () => ModSdkUiContext;
  };
  shell?: {
    useAuth: () => ModShellAuthState;
    useBootstrap: () => ModShellBootstrapState;
    useNavigation: () => ModShellNavigationState;
    useRuntimeFields: () => ModShellRuntimeFieldsState;
    useStatusBanner: () => ModShellStatusBannerState;
  };
  settings?: {
    useRuntimeModSettings: (modId: string) => JsonObject;
    setRuntimeModSettings: (modId: string, settings: JsonObject) => void;
  };
  logging: {
    emitRuntimeLog: (payload: RuntimeLogMessage) => void;
    createRendererFlowId: (prefix: string) => string;
    logRendererEvent: (payload: RendererLogMessage) => void;
  };
  lifecycle: {
    subscribe: (tabId: string, handler: (state: ModLifecycleState) => void) => () => void;
    getState: (tabId: string) => ModLifecycleState;
  };
};

export type { RuntimeHttpContext };
