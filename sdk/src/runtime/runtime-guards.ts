import { ReasonCode } from '../types/index.js';
import type { NimiError } from '../types/index.js';
import { asNimiError, createNimiError } from './errors.js';
import { normalizeText, parseSemverMajor } from './helpers.js';
import type { RuntimeOptions } from './types.js';

export function checkRuntimeVersionCompatibility(input: {
  version: string;
  versionChecked: boolean;
  sdkRuntimeMajor: number;
  emitTelemetry: (name: string, data?: Record<string, unknown>) => void;
  emitError: (error: NimiError) => void;
}): boolean {
  if (input.versionChecked) {
    return true;
  }

  const runtimeMajor = parseSemverMajor(input.version);
  if (runtimeMajor === null) {
    input.emitTelemetry('runtime.version.unparseable', { version: input.version });
    return true;
  }

  if (runtimeMajor !== input.sdkRuntimeMajor) {
    const error = createNimiError({
      message: `runtime major version ${runtimeMajor} is incompatible with SDK major version ${input.sdkRuntimeMajor}`,
      reasonCode: ReasonCode.SDK_RUNTIME_VERSION_INCOMPATIBLE,
      actionHint: 'upgrade_sdk_or_runtime',
      source: 'sdk',
    });
    input.emitError(error);
    throw error;
  }

  input.emitTelemetry('runtime.version.compatible', {
    runtimeVersion: input.version,
    sdkMajor: input.sdkRuntimeMajor,
  });
  return true;
}

export function assertRuntimeMethodAvailable(input: {
  moduleKey: string;
  methodKey: string;
  runtimeVersion: string | null;
  sdkRuntimeMajor: number;
  phase2ModuleKeys: ReadonlySet<string>;
  phase2AuditMethodIds: ReadonlySet<string>;
  auditMethodIds: Record<string, string>;
}): void {
  const isPhase2Module = input.phase2ModuleKeys.has(input.moduleKey);
  const isPhase2AuditMethod = input.moduleKey === 'audit'
    && input.phase2AuditMethodIds.has(
      input.auditMethodIds[input.methodKey] || '',
    );

  if (!isPhase2Module && !isPhase2AuditMethod) {
    return;
  }

  if (!input.runtimeVersion) {
    return;
  }

  const runtimeMajor = parseSemverMajor(input.runtimeVersion);
  if (runtimeMajor === null) {
    return;
  }

  if (runtimeMajor < input.sdkRuntimeMajor) {
    throw createNimiError({
      message: `${input.moduleKey}.${input.methodKey} is unavailable: runtime version ${input.runtimeVersion} does not support this Phase 2 method`,
      reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
      actionHint: 'upgrade_runtime_to_support_method',
      source: 'sdk',
    });
  }
}

export function wrapModeDStream<T>(input: {
  source: AsyncIterable<T>;
  onCancelled: () => void;
}): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      try {
        yield* input.source;
      } catch (error) {
        const normalized = asNimiError(error, {
          reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
          source: 'runtime',
        });
        const isCancelled = normalized.reasonCode === ReasonCode.RUNTIME_GRPC_CANCELLED
          || normalized.message.includes(ReasonCode.RUNTIME_GRPC_CANCELLED);
        if (isCancelled) {
          input.onCancelled();
          return;
        }
        throw normalized;
      }
    },
  };
}

export async function resolveRuntimeSubjectUserId(input: {
  explicit?: string;
  authContext?: RuntimeOptions['authContext'];
}): Promise<string> {
  const direct = normalizeText(input.explicit);
  if (direct) {
    return direct;
  }

  const configured = normalizeText(input.authContext?.subjectUserId);
  if (configured) {
    return configured;
  }

  const resolver = input.authContext?.getSubjectUserId;
  if (typeof resolver === 'function') {
    const resolved = normalizeText(await resolver());
    if (resolved) {
      return resolved;
    }
  }

  throw createNimiError({
    message: 'subjectUserId is required (set authContext or pass per call)',
    reasonCode: ReasonCode.AUTH_CONTEXT_MISSING,
    actionHint: 'set_runtime_auth_context_subject_user',
    source: 'sdk',
  });
}
