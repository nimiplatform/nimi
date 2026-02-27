import type { HookSourceType, RuntimeHttpContext } from './runtime-hook';
import type { RuntimeHookRuntimeFacade } from './runtime-hook/runtime-facade';
import type {
  ResolvedRuntimeRouteBinding,
  RuntimeLlmHealthInput,
  RuntimeLlmHealthResult,
  RuntimeRouteHint,
  RuntimeRouteOverride,
} from './llm';
import type { AiRuntimeDependencySnapshot } from '../ai/types';

export type ModRuntimeHost = {
  checkLocalLlmHealth: (input: RuntimeLlmHealthInput) => Promise<RuntimeLlmHealthResult>;
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
