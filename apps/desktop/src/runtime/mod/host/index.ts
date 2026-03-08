import { DesktopExecutionKernelService } from '@runtime/execution-kernel';
import type { DesktopHookRuntimeService } from '@runtime/hook';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type {
  RegisterRuntimeModOptions,
  RuntimeHttpContext,
  RuntimeHttpContextProvider,
  RuntimeModSdkContextProvider,
  RuntimeModRegistration,
} from '../types';
import type { ModRuntimeContext } from '@nimiplatform/sdk/mod/types';
import { emitRuntimeModRuntimeLog } from '../logging';
import {
  registerRuntimeModLifecycle,
  unregisterRuntimeModLifecycle,
} from './lifecycle';
import {
  clearRuntimeModSdkContextProviderState,
  getRuntimeModSdkContextState,
  getRuntimeHttpContextState,
  setRuntimeModSdkContextProviderState,
  setRuntimeHttpContextProviderState,
} from './runtime-exposure';

let kernelInstance: DesktopExecutionKernelService | null = null;
let hookRuntimeInstance: DesktopHookRuntimeService | null = null;
const registeredMods = new Map<string, RuntimeModRegistration>();
let defaultPrivateExecutionModId = '';

function getOrCreateKernel(): DesktopExecutionKernelService {
  if (!kernelInstance) {
    kernelInstance = new DesktopExecutionKernelService();
  }
  return kernelInstance;
}

function getOrCreateHookRuntime(): DesktopHookRuntimeService {
  if (!hookRuntimeInstance) {
    hookRuntimeInstance = getOrCreateKernel().getHookRuntime();
  }
  return hookRuntimeInstance;
}

export function getRuntimeKernel(): DesktopExecutionKernelService {
  return getOrCreateKernel();
}

export function getRuntimeHookRuntime(): DesktopHookRuntimeService {
  return getOrCreateHookRuntime();
}

export function setRuntimeHttpContextProvider(provider: RuntimeHttpContextProvider): void {
  setRuntimeHttpContextProviderState(provider);
  emitRuntimeModRuntimeLog({
    level: 'debug',
    message: 'action:set-runtime-http-context-provider:done',
    source: 'setRuntimeHttpContextProvider',
  });
}

export function setRuntimeModSdkContextProvider(provider: RuntimeModSdkContextProvider): void {
  setRuntimeModSdkContextProviderState(provider);
  emitRuntimeModRuntimeLog({
    level: 'debug',
    message: 'action:set-runtime-mod-sdk-context-provider:done',
    source: 'setRuntimeModSdkContextProvider',
  });
}

export function getRuntimeHttpContext(): RuntimeHttpContext {
  return getRuntimeHttpContextState();
}

function buildFallbackRuntimeModSdkContext(): ModRuntimeContext {
  const hookRuntime = getOrCreateHookRuntime();
  const notReady = () => createNimiError({
    message: 'runtime mod sdk context provider is not ready',
    reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
    actionHint: 'ensure_mod_host_initialized',
    source: 'runtime',
  });
  return {
    runtime: hookRuntime,
    runtimeHost: {
      checkLocalLlmHealth: async () => ({
        healthy: false,
        status: 'unavailable',
        detail: 'runtime mod sdk context provider is not ready',
      }),
      getRuntimeHookRuntime: () => hookRuntime,
      getModAiDependencySnapshot: async (input: { modId: string }) => ({
        modId: String(input.modId || '').trim(),
        status: 'missing',
        routeSource: 'unknown',
        warnings: ['runtime mod sdk context provider is not ready'],
        dependencies: [],
        repairActions: [],
        updatedAt: new Date().toISOString(),
      }),
      route: {
        listOptions: async () => { throw notReady(); },
        resolve: async () => { throw notReady(); },
        checkHealth: async () => ({
          healthy: false,
          status: 'unavailable',
          detail: 'runtime mod sdk context provider is not ready',
          provider: '',
          reasonCode: ReasonCode.RUNTIME_ROUTE_UNAVAILABLE,
          actionHint: 'verify-connector',
        }),
      },
      local: {
        listArtifacts: async () => { throw notReady(); },
      },
      ai: {
        text: {
          generate: async () => { throw notReady(); },
          stream: async () => { throw notReady(); },
        },
        embedding: {
          generate: async () => { throw notReady(); },
        },
      },
      media: {
        image: {
          generate: async () => { throw notReady(); },
          stream: async () => { throw notReady(); },
        },
        video: {
          generate: async () => { throw notReady(); },
          stream: async () => { throw notReady(); },
        },
        tts: {
          synthesize: async () => { throw notReady(); },
          stream: async () => { throw notReady(); },
          listVoices: async () => { throw notReady(); },
        },
        stt: {
          transcribe: async () => { throw notReady(); },
        },
        jobs: {
          submit: async () => { throw notReady(); },
          get: async () => { throw notReady(); },
          cancel: async () => { throw notReady(); },
          subscribe: async () => { throw notReady(); },
          getArtifacts: async () => { throw notReady(); },
        },
      },
      voice: {
        getAsset: async () => { throw notReady(); },
        listAssets: async () => { throw notReady(); },
        deleteAsset: async () => { throw notReady(); },
        listPresetVoices: async () => { throw notReady(); },
      },
    },
  };
}

function getRuntimeModSdkContext(): ModRuntimeContext {
  const context = getRuntimeModSdkContextState();
  if (context) {
    return context;
  }
  return buildFallbackRuntimeModSdkContext();
}

export function unregisterRuntimeMod(modId: string): boolean {
  const result = unregisterRuntimeModLifecycle({
    modId,
    registeredMods,
    hookRuntime: getOrCreateHookRuntime(),
    kernel: getOrCreateKernel(),
    getHttpContext: getRuntimeHttpContext,
    sdkRuntimeContext: getRuntimeModSdkContext(),
    defaultPrivateExecutionModId,
  });
  defaultPrivateExecutionModId = result.defaultPrivateExecutionModId;
  return result.removed;
}

export function listRegisteredRuntimeModIds(): string[] {
  return Array.from(registeredMods.keys());
}

export async function registerRuntimeMod(
  mod: RuntimeModRegistration,
  options: RegisterRuntimeModOptions = {},
): Promise<void> {
  const kernel = getOrCreateKernel();
  const hookRuntime = getOrCreateHookRuntime();
  const result = await registerRuntimeModLifecycle({
    mod,
    options,
    registeredMods,
    hookRuntime,
    kernel,
    getHttpContext: getRuntimeHttpContext,
    sdkRuntimeContext: getRuntimeModSdkContext(),
    defaultPrivateExecutionModId,
    unregisterRuntimeMod: (targetModId) => unregisterRuntimeMod(targetModId),
  });
  defaultPrivateExecutionModId = result.defaultPrivateExecutionModId;
}

export function resetRuntimeHostForTesting(): void {
  registeredMods.clear();
  defaultPrivateExecutionModId = '';
  clearRuntimeModSdkContextProviderState();
  hookRuntimeInstance = null;
  kernelInstance = null;
}
