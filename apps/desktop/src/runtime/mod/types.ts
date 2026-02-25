import type { DesktopExecutionKernelService } from '@runtime/execution-kernel';
import type { DesktopHookRuntimeService, HookSourceType } from '@runtime/hook';

export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type RuntimeHttpContext = {
  apiBaseUrl: string;
  accessToken?: string;
  fetchImpl?: FetchImpl;
};

export type RuntimeHttpContextProvider = () => RuntimeHttpContext;

export type RegisterRuntimeModOptions = {
  replaceExisting?: boolean;
};

export type RuntimeModRegisterFailureStage = 'discover' | 'setup';

export type RuntimeModRegisterFailure = {
  modId: string;
  sourceType: HookSourceType;
  stage: RuntimeModRegisterFailureStage;
  error: string;
};

export type RegisterRuntimeModsResult = {
  registeredModIds: string[];
  failedMods: RuntimeModRegisterFailure[];
};

export type RuntimeModLifecycleContext = {
  kernel: DesktopExecutionKernelService;
  hookRuntime: DesktopHookRuntimeService;
  getHttpContext: () => RuntimeHttpContext;
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

export type RuntimeModFactory = () => RuntimeModRegistration;

export type RuntimeLocalManifestSummaryLike = {
  path: string;
  id: string;
  entry?: string;
  entryPath?: string;
  manifest?: Record<string, unknown>;
};

declare global {
  interface Window {
    __NIMI_RUNTIME_MOD_FACTORIES__?: RuntimeModFactory[];
  }
}
