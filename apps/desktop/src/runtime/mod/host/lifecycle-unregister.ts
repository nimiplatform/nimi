import type {
  RuntimeHttpContext,
  RuntimeModLifecycleContext,
  RuntimeModRegistration,
} from '../types';
import type { DesktopHookRuntimeService } from '@runtime/hook';
import type { DesktopExecutionKernelService } from '@runtime/execution-kernel';
import { emitRuntimeModRuntimeLog } from '../logging';

export function resolveDefaultPrivateExecutionModId(
  registeredMods: Map<string, RuntimeModRegistration>,
): string {
  for (const registration of registeredMods.values()) {
    if (registration.isDefaultPrivateExecution) {
      return registration.modId;
    }
  }
  return '';
}

export function unregisterRuntimeModState(input: {
  modId: string;
  registeredMods: Map<string, RuntimeModRegistration>;
  hookRuntime: DesktopHookRuntimeService;
  kernel: DesktopExecutionKernelService;
  getHttpContext: () => RuntimeHttpContext;
  defaultPrivateExecutionModId: string;
}): { removed: boolean; defaultPrivateExecutionModId: string } {
  const targetModId = String(input.modId || '').trim();
  if (!targetModId) {
    return {
      removed: false,
      defaultPrivateExecutionModId: input.defaultPrivateExecutionModId,
    };
  }
  if (!input.registeredMods.has(targetModId)) {
    return {
      removed: false,
      defaultPrivateExecutionModId: input.defaultPrivateExecutionModId,
    };
  }

  const registration = input.registeredMods.get(targetModId);
  if (registration?.teardown) {
    const teardownContext: RuntimeModLifecycleContext = {
      kernel: input.kernel,
      hookRuntime: input.hookRuntime,
      getHttpContext: input.getHttpContext,
    };
    try {
      const teardownResult = registration.teardown(teardownContext);
      if (teardownResult && typeof (teardownResult as Promise<void>).then === 'function') {
        void Promise.resolve(teardownResult).catch((error) => {
          emitRuntimeModRuntimeLog({
            level: 'warn',
            message: 'action:runtime-mod:teardown:failed',
            source: 'unregisterRuntimeModState',
            details: {
              modId: targetModId,
              error: error instanceof Error ? error.message : String(error || ''),
            },
          });
        });
      }
    } catch (error) {
      emitRuntimeModRuntimeLog({
        level: 'warn',
        message: 'action:runtime-mod:teardown:failed',
        source: 'unregisterRuntimeModState',
        details: {
          modId: targetModId,
          error: error instanceof Error ? error.message : String(error || ''),
        },
      });
    }
  }

  input.hookRuntime.suspendMod(targetModId);
  input.hookRuntime.clearGrantCapabilities(targetModId);
  input.hookRuntime.clearDenialCapabilities(targetModId);
  input.hookRuntime.clearCapabilityBaseline(targetModId);
  input.registeredMods.delete(targetModId);
  const nextDefaultPrivateExecutionModId =
    input.defaultPrivateExecutionModId === targetModId
      ? resolveDefaultPrivateExecutionModId(input.registeredMods)
      : input.defaultPrivateExecutionModId;

  return {
    removed: true,
    defaultPrivateExecutionModId: nextDefaultPrivateExecutionModId,
  };
}
