import { DesktopExecutionKernelService } from '@runtime/execution-kernel';
import type { DesktopHookRuntimeService } from '@runtime/hook';
import type {
  RegisterRuntimeModOptions,
  RuntimeHttpContext,
  RuntimeHttpContextProvider,
  RuntimeModRegistration,
} from '../types';
import { emitRuntimeModRuntimeLog } from '../logging';
import {
  registerRuntimeModLifecycle,
  unregisterRuntimeModLifecycle,
} from './lifecycle';
import {
  getRuntimeHttpContextState,
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

export function getRuntimeHttpContext(): RuntimeHttpContext {
  return getRuntimeHttpContextState();
}

export function unregisterRuntimeMod(modId: string): boolean {
  const result = unregisterRuntimeModLifecycle({
    modId,
    registeredMods,
    hookRuntime: getOrCreateHookRuntime(),
    kernel: getOrCreateKernel(),
    getHttpContext: getRuntimeHttpContext,
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
    defaultPrivateExecutionModId,
    unregisterRuntimeMod: (targetModId) => unregisterRuntimeMod(targetModId),
  });
  defaultPrivateExecutionModId = result.defaultPrivateExecutionModId;
}

export function resetRuntimeHostForTesting(): void {
  registeredMods.clear();
  defaultPrivateExecutionModId = '';
  hookRuntimeInstance = null;
  kernelInstance = null;
}
