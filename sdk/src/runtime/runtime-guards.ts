import type { JsonObject } from '../internal/utils.js';
import { ReasonCode } from '../types/index.js';
import type { NimiError, VersionCompatibilityStatus } from '../types/index.js';
import { asNimiError, createNimiError } from './errors.js';
import { RoutePolicy } from './generated/runtime/v1/ai.js';
import { normalizeText, parseSemverMajor } from './helpers.js';
import type { RuntimeMetadata, RuntimeOptions } from './types.js';

export function checkRuntimeVersionCompatibility(input: {
  version: string;
  versionChecked: boolean;
  sdkRuntimeMajor: number;
  emitTelemetry: (name: string, data?: JsonObject) => void;
  emitError: (error: NimiError) => void;
  setStatus?: (status: VersionCompatibilityStatus) => void;
}): VersionCompatibilityStatus {
  const runtimeMajor = parseSemverMajor(input.version);
  const baseStatus: VersionCompatibilityStatus = {
    state: 'incompatible',
    compatible: false,
    checked: true,
    sdkRuntimeMajor: input.sdkRuntimeMajor,
    runtimeVersion: input.version,
    runtimeMajor,
  };
  if (runtimeMajor === null) {
    const status: VersionCompatibilityStatus = {
      ...baseStatus,
      reason: 'runtime_version_unparseable',
    };
    input.setStatus?.(status);
    const error = createNimiError({
      message: `runtime version is unparseable: ${input.version}`,
      reasonCode: ReasonCode.SDK_RUNTIME_VERSION_INCOMPATIBLE,
      actionHint: 'check_runtime_version_format',
      source: 'sdk',
    });
    input.emitError(error);
    throw error;
  }

  if (runtimeMajor !== input.sdkRuntimeMajor) {
    const status: VersionCompatibilityStatus = {
      ...baseStatus,
      reason: 'major_mismatch',
    };
    input.setStatus?.(status);
    const error = createNimiError({
      message: `runtime major version ${runtimeMajor} is incompatible with SDK major version ${input.sdkRuntimeMajor}`,
      reasonCode: ReasonCode.SDK_RUNTIME_VERSION_INCOMPATIBLE,
      actionHint: 'upgrade_sdk_or_runtime',
      source: 'sdk',
    });
    input.emitError(error);
    throw error;
  }

  const status: VersionCompatibilityStatus = {
    state: 'compatible',
    compatible: true,
    checked: true,
    sdkRuntimeMajor: input.sdkRuntimeMajor,
    runtimeVersion: input.version,
    runtimeMajor,
  };
  input.setStatus?.(status);
  if (!input.versionChecked) {
    input.emitTelemetry('runtime.version.compatible', {
      runtimeVersion: input.version,
      sdkMajor: input.sdkRuntimeMajor,
    });
  }
  return status;
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
  subjectContext?: RuntimeOptions['subjectContext'];
}): Promise<string> {
  const resolved = await resolveOptionalRuntimeSubjectUserId(input);
  if (resolved) {
    return resolved;
  }

  throw createNimiError({
    message: 'subjectUserId is required (set subjectContext or pass per call)',
    reasonCode: ReasonCode.AUTH_CONTEXT_MISSING,
    actionHint: 'set_runtime_subject_context_subject_user',
    source: 'sdk',
  });
}

export async function resolveOptionalRuntimeSubjectUserId(input: {
  explicit?: string;
  subjectContext?: RuntimeOptions['subjectContext'];
}): Promise<string | undefined> {
  const direct = normalizeText(input.explicit);
  if (direct) {
    return direct;
  }

  const configured = normalizeText(input.subjectContext?.subjectUserId);
  if (configured) {
    return configured;
  }

  const resolver = input.subjectContext?.getSubjectUserId;
  if (typeof resolver === 'function') {
    const resolved = normalizeText(await resolver());
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

type RuntimeAiRequestLike = {
  routePolicy?: RoutePolicy;
  connectorId?: string;
  head?: {
    routePolicy?: RoutePolicy;
    connectorId?: string;
  };
};

type RuntimeAiMetadataLike =
  | Pick<RuntimeMetadata, 'keySource' | 'providerType' | 'providerEndpoint' | 'providerApiKey'>
  | JsonObject
  | undefined;

function metadataValue(metadata: RuntimeAiMetadataLike, key: string, altKey?: string): string {
  if (!metadata) {
    return '';
  }
  const record = metadata as JsonObject;
  return normalizeText(record[key] ?? (altKey ? record[altKey] : undefined));
}

function runtimeAiRoutePolicy(request: RuntimeAiRequestLike): RoutePolicy {
  return request.routePolicy ?? request.head?.routePolicy ?? RoutePolicy.UNSPECIFIED;
}

function runtimeAiConnectorId(request: RuntimeAiRequestLike): string {
  return normalizeText(request.connectorId ?? request.head?.connectorId);
}

export function runtimeAiRequestRequiresSubject(input: {
  request: RuntimeAiRequestLike;
  metadata?: RuntimeAiMetadataLike;
}): boolean {
  if (runtimeAiRoutePolicy(input.request) !== RoutePolicy.LOCAL) {
    return true;
  }
  if (runtimeAiConnectorId(input.request)) {
    return true;
  }

  const keySource = metadataValue(input.metadata, 'keySource', 'x-nimi-key-source').toLowerCase();
  if (keySource === 'managed' || keySource === 'inline') {
    return true;
  }

  const providerType = metadataValue(input.metadata, 'providerType', 'x-nimi-provider-type');
  const providerEndpoint = metadataValue(input.metadata, 'providerEndpoint', 'x-nimi-provider-endpoint');
  const providerApiKey = metadataValue(input.metadata, 'providerApiKey', 'x-nimi-provider-api-key');
  if (providerType || providerEndpoint || providerApiKey) {
    return true;
  }

  return false;
}
