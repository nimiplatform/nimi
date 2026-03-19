import type { ComponentType, ReactNode } from 'react';
import type { JsonObject } from '../../internal/utils.js';
import type {
  RuntimeHttpContext,
} from '../types/runtime-hook';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-facade';
import type {
  RuntimeLlmHealthInput,
  RuntimeLlmHealthResult,
  RuntimeRouteHealthResult,
} from '../types/llm';
import type {
  ModRuntimeBoundEmbeddingGenerateInput,
  ModRuntimeLocalProfileSnapshot,
  ModRuntimeBoundImageGenerateInput,
  ModRuntimeLocalProfile,
  ModRuntimeLocalProfileInstallResult,
  ModRuntimeLocalProfileInstallStatus,
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

export type ModSdkHost = {
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
    };
  local: {
    listArtifacts: (input: ModRuntimeListLocalArtifactsInput & {
      modId: string;
    }) => Promise<ModRuntimeLocalArtifactRecord[]>;
    listProfiles: (input: {
      modId: string;
    }) => Promise<ModRuntimeLocalProfile[]>;
    requestProfileInstall: (input: {
      modId: string;
      profileId: string;
      capability?: RuntimeCanonicalCapability | string;
      confirmMessage?: string;
    }) => Promise<ModRuntimeLocalProfileInstallResult>;
    getProfileInstallStatus: (input: {
      modId: string;
      profileId: string;
      capability?: RuntimeCanonicalCapability | string;
    }) => Promise<ModRuntimeLocalProfileInstallStatus>;
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
