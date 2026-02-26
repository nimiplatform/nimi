import type { HookSourceType, RuntimeHttpContext } from './runtime-hook';
import type { RuntimeHookRuntimeFacade } from './runtime-hook/runtime-facade';

export type RuntimeModLifecycleContext = {
  kernel: unknown;
  hookRuntime: RuntimeHookRuntimeFacade;
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
