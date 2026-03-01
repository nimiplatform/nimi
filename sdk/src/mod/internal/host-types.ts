import type { ComponentType, ReactNode } from 'react';
import type {
  RuntimeHttpContext,
} from '../types/runtime-hook/index';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-hook/runtime-facade';
import type {
  ResolvedRuntimeRouteBinding,
  RuntimeLlmHealthInput,
  RuntimeLlmHealthResult,
  RuntimeRouteHint,
  RuntimeRouteOverride,
} from '../types/llm';
import type { AiRuntimeDependencySnapshot } from '../ai/types';

export type RuntimeLogMessage = {
  level: 'debug' | 'info' | 'warn' | 'error';
  area: string;
  message: string;
  traceId?: string;
  flowId?: string;
  source?: string;
  costMs?: number;
  details?: Record<string, unknown>;
};

export type RendererLogMessage = {
  level?: 'debug' | 'info' | 'warn' | 'error';
  area: string;
  message: string;
  flowId?: string;
  source?: string;
  costMs?: number;
  details?: Record<string, unknown>;
};

export type ModSdkUiContext = {
  isAuthenticated: boolean;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  runtimeFields: Record<string, string | number | boolean>;
  setRuntimeFields: (fields: Record<string, string | number | boolean>) => void;
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
  extra?: Record<string, unknown>;
};

export type RuntimeKernelTurnResult = {
  text?: string;
  promptTraceId?: string;
  latencyMs?: number;
  provider?: string;
  detail?: string;
  error?: string;
  [key: string]: unknown;
};

export type ModSdkHost = {
  runtime: {
    checkLocalLlmHealth: (input: RuntimeLlmHealthInput) => Promise<RuntimeLlmHealthResult>;
    executeLocalKernelTurn: (input: RuntimeKernelTurnInput) => Promise<RuntimeKernelTurnResult>;
    withOpenApiContextLock: <T>(
      context: RuntimeHttpContext,
      task: () => Promise<T>,
    ) => Promise<T>;
    getRuntimeHookRuntime: () => RuntimeHookRuntimeFacade;
    resolveRouteBinding: (input: {
      routeHint: RuntimeRouteHint;
      modId?: string;
      routeOverride?: RuntimeRouteOverride;
    }) => Promise<ResolvedRuntimeRouteBinding>;
    getModAiDependencySnapshot: (input: {
      modId: string;
      capability?: string;
      routeSourceHint?: 'token-api' | 'local-runtime';
    }) => Promise<AiRuntimeDependencySnapshot>;
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
  logging: {
    emitRuntimeLog: (payload: RuntimeLogMessage) => void;
    createRendererFlowId: (prefix: string) => string;
    logRendererEvent: (payload: RendererLogMessage) => void;
  };
};

export type { RuntimeHttpContext };
