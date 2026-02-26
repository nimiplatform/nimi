import { createRuntimeModFlowId, emitRuntimeModRuntimeLog } from '../logging';
import { ReasonCode } from '@nimiplatform/sdk/types';

type RuntimeModLifecycleStatus = 'start' | 'done' | 'failed' | 'skipped';

function withLifecycleStatus<T extends Record<string, unknown>>(
  status: RuntimeModLifecycleStatus,
  details: T,
): T & { status: RuntimeModLifecycleStatus } {
  return {
    ...details,
    status,
  };
}

export function createRuntimeModRegisterFlowId(): string {
  return createRuntimeModFlowId('runtime-mod-register');
}

export function createRuntimeModUnregisterFlowId(): string {
  return createRuntimeModFlowId('runtime-mod-unregister');
}

export function emitRuntimeModRegisterStart(input: {
  flowId: string;
  modId: string;
  replaceExisting: boolean;
  alreadyRegistered: boolean;
  capabilitiesCount: number;
  isDefaultPrivateExecution: boolean;
  sourceType: string;
  baselineCapabilityCount: number;
  manifestCapabilityCount: number;
}) {
  emitRuntimeModRuntimeLog({
    level: 'info',
    message: 'action:register-runtime-mod:start',
    flowId: input.flowId,
    source: 'registerRuntimeMod',
    details: withLifecycleStatus('start', {
      modId: input.modId,
      replaceExisting: input.replaceExisting,
      alreadyRegistered: input.alreadyRegistered,
      capabilitiesCount: input.capabilitiesCount,
      isDefaultPrivateExecution: input.isDefaultPrivateExecution,
      sourceType: input.sourceType,
      baselineCapabilityCount: input.baselineCapabilityCount,
      manifestCapabilityCount: input.manifestCapabilityCount,
    }),
  });
}

export function emitRuntimeModRegisterSkipped(input: {
  flowId: string;
  modId: string;
  reason: string;
}) {
  emitRuntimeModRuntimeLog({
    level: 'warn',
    message: 'action:register-runtime-mod:skipped',
    flowId: input.flowId,
    source: 'registerRuntimeMod',
    details: withLifecycleStatus('skipped', {
      modId: input.modId,
      reasonCode: input.reason,
    }),
  });
}

export function emitRuntimeModRegisterDone(input: {
  flowId: string;
  startedAt: number;
  modId: string;
  registeredCount: number;
  defaultPrivateExecutionModId: string;
  sourceType: string;
  baselineCapabilities: string[];
}) {
  emitRuntimeModRuntimeLog({
    level: 'info',
    message: 'action:register-runtime-mod:done',
    flowId: input.flowId,
    source: 'registerRuntimeMod',
    costMs: Date.now() - input.startedAt,
    details: withLifecycleStatus('done', {
      modId: input.modId,
      registeredCount: input.registeredCount,
      defaultPrivateExecutionModId: input.defaultPrivateExecutionModId || null,
      sourceType: input.sourceType,
      baselineCapabilities: input.baselineCapabilities,
    }),
  });
}

export function emitRuntimeModRegisterFailed(input: {
  flowId: string;
  startedAt: number;
  modId: string;
  error: unknown;
}) {
  emitRuntimeModRuntimeLog({
    level: 'error',
    message: 'action:register-runtime-mod:failed',
    flowId: input.flowId,
    source: 'registerRuntimeMod',
    costMs: Date.now() - input.startedAt,
    details: withLifecycleStatus('failed', {
      modId: input.modId,
      reasonCode: ReasonCode.RUNTIME_MOD_REGISTER_FAILED,
      error: input.error instanceof Error ? input.error.message : String(input.error || ''),
    }),
  });
}

export function emitRuntimeModUnregisterSkipped(input: {
  flowId: string;
  modId: string;
  reason: 'empty-mod-id' | 'mod-not-registered';
}) {
  emitRuntimeModRuntimeLog({
    level: input.reason === 'empty-mod-id' ? 'warn' : 'debug',
    message: 'action:unregister-runtime-mod:skipped',
    flowId: input.flowId,
    source: 'unregisterRuntimeMod',
    details: withLifecycleStatus('skipped', {
      reasonCode: input.reason,
      ...(input.reason === 'mod-not-registered' ? { modId: input.modId } : {}),
    }),
  });
}

export function emitRuntimeModUnregisterDone(input: {
  flowId: string;
  startedAt: number;
  modId: string;
  remainingCount: number;
  defaultPrivateExecutionModId: string;
}) {
  emitRuntimeModRuntimeLog({
    level: 'info',
    message: 'action:unregister-runtime-mod:done',
    flowId: input.flowId,
    source: 'unregisterRuntimeMod',
    costMs: Date.now() - input.startedAt,
    details: withLifecycleStatus('done', {
      modId: input.modId,
      remainingCount: input.remainingCount,
      defaultPrivateExecutionModId: input.defaultPrivateExecutionModId || null,
    }),
  });
}
