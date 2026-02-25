import {
  registerRuntimeMod,
  unregisterRuntimeMod,
  listRegisteredRuntimeModIds,
} from './host';
import {
  discoverInjectedRuntimeMods,
} from './discovery';
import type { RuntimeModRegistration } from './types';
import type { RegisterRuntimeModsResult, RuntimeModRegisterFailure } from './types';
import { createRuntimeModFlowId, emitRuntimeModRuntimeLog } from './logging';

function emitRegistrationBatchLog(input: {
  level: 'debug' | 'info' | 'warn';
  message: Parameters<typeof emitRuntimeModRuntimeLog>[0]['message'];
  flowId: string;
  costMs?: number;
  details?: Record<string, unknown>;
}) {
  emitRuntimeModRuntimeLog({
    level: input.level,
    message: input.message,
    flowId: input.flowId,
    source: 'registerRuntimeMods',
    costMs: input.costMs,
    details: input.details,
  });
}

function emitUnregisterBatchLog(input: {
  level: 'debug' | 'info' | 'warn';
  message: Parameters<typeof emitRuntimeModRuntimeLog>[0]['message'];
  flowId: string;
  costMs?: number;
  details?: Record<string, unknown>;
}) {
  emitRuntimeModRuntimeLog({
    level: input.level,
    message: input.message,
    flowId: input.flowId,
    source: 'unregisterRuntimeMods',
    costMs: input.costMs,
    details: input.details,
  });
}

function emitInjectedBatchLog(input: {
  level: 'info' | 'warn';
  message: Parameters<typeof emitRuntimeModRuntimeLog>[0]['message'];
  flowId: string;
  costMs?: number;
  details?: Record<string, unknown>;
}) {
  emitRuntimeModRuntimeLog({
    level: input.level,
    message: input.message,
    flowId: input.flowId,
    source: 'registerInjectedRuntimeMods',
    costMs: input.costMs,
    details: input.details,
  });
}

export async function registerRuntimeMods(
  registrations: RuntimeModRegistration[],
  options: {
    replaceExisting?: boolean;
  } = {},
): Promise<RegisterRuntimeModsResult> {
  const flowId = createRuntimeModFlowId('runtime-mod-register-batch');
  const startedAt = Date.now();
  emitRegistrationBatchLog({
    level: 'info',
    message: 'action:register-runtime-mods:start',
    flowId,
    details: {
      inputCount: registrations.length,
      replaceExisting: Boolean(options.replaceExisting),
    },
  });
  const deduped = new Map<string, RuntimeModRegistration>();
  const failedMods: RuntimeModRegisterFailure[] = [];
  for (const registration of registrations) {
    if (!registration?.modId) {
      continue;
    }
    deduped.set(registration.modId, registration);
  }

  for (const registration of deduped.values()) {
    try {
      await registerRuntimeMod(registration, {
        replaceExisting: options.replaceExisting,
      });
    } catch (error) {
      failedMods.push({
        modId: registration.modId,
        sourceType: registration.sourceType || 'sideload',
        stage: 'setup',
        error: error instanceof Error ? error.message : String(error || 'register failed'),
      });
    }
  }
  emitRegistrationBatchLog({
    level: 'info',
    message: 'action:register-runtime-mods:done',
    flowId,
    costMs: Date.now() - startedAt,
    details: {
      inputCount: registrations.length,
      dedupedCount: deduped.size,
      replaceExisting: Boolean(options.replaceExisting),
      failedCount: failedMods.length,
    },
  });
  if (failedMods.length > 0) {
    emitRegistrationBatchLog({
      level: 'warn',
      message: 'action:runtime-mod:register:partial-failed',
      flowId,
      details: {
        failedMods: failedMods.map((item) => ({
          modId: item.modId,
          sourceType: item.sourceType,
          stage: item.stage,
          error: item.error,
        })),
      },
    });
  }
  return {
    registeredModIds: listRegisteredRuntimeModIds(),
    failedMods,
  };
}

export function unregisterRuntimeMods(modIds: string[]): string[] {
  const flowId = createRuntimeModFlowId('runtime-mod-unregister-batch');
  const startedAt = Date.now();
  emitUnregisterBatchLog({
    level: 'debug',
    message: 'action:unregister-runtime-mods:start',
    flowId,
    details: {
      inputCount: modIds.length,
    },
  });
  const removed: string[] = [];
  for (const modId of modIds) {
    const ok = unregisterRuntimeMod(modId);
    if (ok) {
      removed.push(modId);
    }
  }
  emitUnregisterBatchLog({
    level: 'info',
    message: 'action:unregister-runtime-mods:done',
    flowId,
    costMs: Date.now() - startedAt,
    details: {
      inputCount: modIds.length,
      removedCount: removed.length,
    },
  });
  return removed;
}

export async function registerInjectedRuntimeMods(): Promise<RegisterRuntimeModsResult> {
  const flowId = createRuntimeModFlowId('runtime-mod-register-injected');
  const startedAt = Date.now();
  emitInjectedBatchLog({
    level: 'info',
    message: 'action:register-injected-runtime-mods:start',
    flowId,
  });
  const injected = discoverInjectedRuntimeMods();
  const result = await registerRuntimeMods(injected, {
    replaceExisting: false,
  });
  emitInjectedBatchLog({
    level: result.failedMods.length > 0 ? 'warn' : 'info',
    message: 'action:register-injected-runtime-mods:done',
    flowId,
    costMs: Date.now() - startedAt,
    details: {
      injectedCount: injected.length,
      totalCount: result.registeredModIds.length,
      failureCount: result.failedMods.length,
    },
  });
  return result;
}
