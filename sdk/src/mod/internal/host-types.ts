import type { ComponentType, ReactNode } from 'react';
import type { JsonObject } from '../../internal/utils.js';
import type {
  ModRuntimeHost,
  RuntimeHttpContext,
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
} from '../types/index.js';

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

export type ModSdkRuntimeHost = ModRuntimeHost & {
  executeLocalKernelTurn: (input: RuntimeKernelTurnInput) => Promise<RuntimeKernelTurnResult>;
  withOpenApiContextLock: <T>(
    context: RuntimeHttpContext,
    task: () => Promise<T>,
  ) => Promise<T>;
};

export type ModSdkHost = {
  worldEvolution: ModWorldEvolutionHost;
  runtime: ModSdkRuntimeHost;
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
