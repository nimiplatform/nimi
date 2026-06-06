import {
  SchedulingState,
  type PeekSchedulingRequest,
  type PeekSchedulingResponse,
  type SchedulingEvaluationTarget,
  type SchedulingJudgement,
  type SchedulingOccupancySnapshot,
  type SchedulingResourceHint,
  type SchedulingTargetJudgement,
} from '../../core-generated/runtime-protobuf/runtime/v1/ai_scheduling';
import type { RuntimeTypedCallOptions } from '../../core-generated/runtime-typed-client';
import { createNimiError } from '../../types';
import type {
  NimiAIConfig,
  NimiAIRuntimeEvidence,
  NimiAISchedulingEvaluationTarget,
  NimiAISchedulingJudgement,
  NimiAISchedulingOccupancy,
  NimiAISchedulingProjection,
  NimiAISchedulingResourceHint,
  NimiAISchedulingState,
  NimiAISchedulingTargetInput,
  NimiAISchedulingTargetJudgement,
} from './config';

export interface NimiRuntimeAISchedulingClient {
  peekScheduling(request: PeekSchedulingRequest, options?: RuntimeTypedCallOptions): Promise<PeekSchedulingResponse>;
}

export interface NimiRuntimeAISchedulingClientOptions {
  readonly runtime:
    | NimiRuntimeAISchedulingClient
    | {
      readonly scheduling?: NimiRuntimeAISchedulingClient;
      readonly generated?: NimiRuntimeAISchedulingClient;
    };
  readonly appId: string;
  readonly config?: NimiAIConfig;
  readonly targets?: readonly NimiAISchedulingTargetInput[];
  readonly callOptions?: RuntimeTypedCallOptions;
}

export interface NimiRuntimeAISchedulingProjectionClient {
  peek(options?: {
    readonly config?: NimiAIConfig;
    readonly targets?: readonly NimiAISchedulingTargetInput[];
    readonly callOptions?: RuntimeTypedCallOptions;
  }): Promise<NimiAISchedulingProjection>;
}

export function createNimiRuntimeAISchedulingClient(
  options: NimiRuntimeAISchedulingClientOptions,
): NimiRuntimeAISchedulingProjectionClient {
  const client = getSchedulingClient(options.runtime);
  const appId = requireText(options.appId, 'Runtime AI scheduling requires appId', 'provide_runtime_ai_scheduling_app_id');
  return {
    async peek(override = {}) {
      const request = buildNimiRuntimeAISchedulingRequest({
        appId,
        config: override.config ?? options.config,
        targets: override.targets ?? options.targets,
      });
      const response = await client.peekScheduling(request, override.callOptions ?? options.callOptions);
      return projectNimiRuntimeAISchedulingResponse(appId, response);
    },
  };
}

export function buildNimiRuntimeAISchedulingRequest(input: {
  readonly appId: string;
  readonly config?: NimiAIConfig;
  readonly targets?: readonly NimiAISchedulingTargetInput[];
}): PeekSchedulingRequest {
  const appId = requireText(input.appId, 'Runtime AI scheduling requires appId', 'provide_runtime_ai_scheduling_app_id');
  const targets = input.targets
    ? input.targets.map(toRuntimeSchedulingTarget)
    : targetsFromAIConfig(input.config);
  if (targets.length === 0) {
    throw schedulingError(
      'SDK_AI_SCHEDULING_TARGET_REQUIRED',
      'Runtime AI scheduling requires at least one live target',
      'provide_runtime_ai_scheduling_targets',
    );
  }
  return { appId, targets };
}

export function projectNimiRuntimeAISchedulingResponse(
  appId: string,
  response: PeekSchedulingResponse,
): NimiAISchedulingProjection {
  return {
    appId,
    occupancy: projectSchedulingOccupancy(response.occupancy),
    aggregateJudgement: response.aggregateJudgement
      ? projectSchedulingJudgement(response.aggregateJudgement)
      : null,
    targetJudgements: response.targetJudgements.map(projectSchedulingTargetJudgement),
    raw: response,
  };
}

export function normalizeNimiAISchedulingState(state: SchedulingState): NimiAISchedulingState {
  switch (state) {
    case SchedulingState.RUNNABLE:
      return 'runnable';
    case SchedulingState.QUEUE_REQUIRED:
      return 'queue_required';
    case SchedulingState.PREEMPTION_RISK:
      return 'preemption_risk';
    case SchedulingState.SLOWDOWN_RISK:
      return 'slowdown_risk';
    case SchedulingState.DENIED:
      return 'denied';
    case SchedulingState.UNKNOWN:
      return 'unknown';
    case SchedulingState.UNSPECIFIED:
    default:
      return 'unknown';
  }
}

export function resolveNimiAIConfigRuntimeSchedulingTargets(
  config: NimiAIConfig,
): NimiAISchedulingEvaluationTarget[] {
  return Object.entries(config.capabilities.targetRefs)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([capability, targetRef]) => {
      if (targetRef.kind !== 'local-runtime') {
        return null;
      }
      return normalizeNimiAISchedulingTarget({
        capability,
        targetRef,
      });
    })
    .filter((target): target is NimiAISchedulingEvaluationTarget => target !== null);
}

export function resolveNimiAIConfigRuntimeSchedulingTargetForCapability(
  config: NimiAIConfig,
  capability: string,
): NimiAISchedulingEvaluationTarget | null {
  const normalizedCapability = normalizeText(capability);
  if (!normalizedCapability) {
    return null;
  }
  const targetRef = config.capabilities.targetRefs[normalizedCapability];
  if (!targetRef || targetRef.kind !== 'local-runtime') {
    return null;
  }
  return normalizeNimiAISchedulingTarget({
    capability: normalizedCapability,
    targetRef,
  });
}

export function normalizeNimiAISchedulingTarget(
  input: NimiAISchedulingTargetInput | null | undefined,
): NimiAISchedulingEvaluationTarget | null {
  if (!input) {
    return null;
  }
  try {
    return fromRuntimeSchedulingTarget(toRuntimeSchedulingTarget(input));
  } catch {
    return null;
  }
}

export function nimiAISchedulingTargetsEqual(
  left: NimiAISchedulingEvaluationTarget,
  right: NimiAISchedulingEvaluationTarget,
): boolean {
  return left.capability === right.capability
    && (left.targetId ?? null) === (right.targetId ?? null)
    && (left.profileId ?? null) === (right.profileId ?? null);
}

export function createNimiAIRuntimeEvidence(input: {
  readonly schedulingJudgement?: NimiAISchedulingJudgement | null;
}): NimiAIRuntimeEvidence | null {
  return input.schedulingJudgement
    ? { schedulingJudgement: input.schedulingJudgement }
    : null;
}

export function projectNimiAIRuntimeEvidenceMetadata(
  evidence: NimiAIRuntimeEvidence | null | undefined,
): Record<string, string> {
  const judgement = evidence?.schedulingJudgement ?? null;
  if (!judgement) {
    return {};
  }
  return {
    runtimeSchedulingState: judgement.state,
    runtimeSchedulingDetail: judgement.detail ?? '',
  };
}

function targetsFromAIConfig(config: NimiAIConfig | undefined): SchedulingEvaluationTarget[] {
  if (!config) {
    throw schedulingError(
      'SDK_AI_SCHEDULING_TARGET_REQUIRED',
      'Runtime AI scheduling requires config or explicit targets',
      'provide_runtime_ai_scheduling_config_or_targets',
    );
  }
  return resolveNimiAIConfigRuntimeSchedulingTargets(config).map(toRuntimeSchedulingTarget);
}

function toRuntimeSchedulingTarget(input: NimiAISchedulingTargetInput): SchedulingEvaluationTarget {
  const capability = requireText(input.capability, 'scheduling target capability is required', 'provide_scheduling_capability');
  const targetRef = input.targetRef;
  if (!targetRef) {
    return {
      capability,
      targetId: requireText(input.targetId, 'scheduling targetId is required', 'provide_scheduling_target_id'),
      profileId: normalizeText(input.profileId),
      resourceHint: toRuntimeResourceHint(input.resourceHint),
    };
  }
  if (targetRef.kind === 'profile-slice') {
    throw schedulingError(
      'SDK_AI_SCHEDULING_TARGET_UNRESOLVED',
      `AIConfig capability ${capability} points to profile-slice ${targetRef.sliceId}, not a live Runtime scheduling target`,
      'materialize_profile_slice_before_scheduling',
    );
  }
  if (targetRef.kind === 'local-runtime') {
    return {
      capability,
      targetId: requireText(
        input.targetId ?? targetRef.targetId ?? targetRef.readinessRef,
        `AIConfig capability ${capability} local-runtime target is missing targetId/readinessRef`,
        'provide_local_runtime_target_id',
      ),
      profileId: normalizeText(input.profileId ?? targetRef.profileId),
      resourceHint: toRuntimeResourceHint(input.resourceHint),
    };
  }
  return {
    capability,
    targetId: requireText(
      input.targetId ?? targetRef.connectorId,
      `AIConfig capability ${capability} cloud-connector target is missing connectorId`,
      'provide_cloud_connector_id',
    ),
    profileId: normalizeText(input.profileId ?? targetRef.providerModelId),
    resourceHint: toRuntimeResourceHint(input.resourceHint),
  };
}

function projectSchedulingJudgement(judgement: SchedulingJudgement): NimiAISchedulingJudgement {
  return {
    state: normalizeNimiAISchedulingState(judgement.state),
    detail: normalizeText(judgement.detail) || null,
    occupancy: projectSchedulingOccupancy(judgement.occupancy),
    resourceWarnings: [...judgement.resourceWarnings],
  };
}

function projectSchedulingTargetJudgement(
  judgement: SchedulingTargetJudgement,
): NimiAISchedulingTargetJudgement {
  return {
    target: fromRuntimeSchedulingTarget(judgement.target),
    judgement: judgement.judgement
      ? projectSchedulingJudgement(judgement.judgement)
      : unknownSchedulingJudgement(),
  };
}

function toRuntimeResourceHint(hint: NimiAISchedulingResourceHint | null | undefined): SchedulingResourceHint | undefined {
  if (!hint) {
    return undefined;
  }
  const engine = normalizeText(hint.engine);
  const estimatedVramBytes = normalizeInt64(hint.estimatedVramBytes);
  const estimatedRamBytes = normalizeInt64(hint.estimatedRamBytes);
  const estimatedDiskBytes = normalizeInt64(hint.estimatedDiskBytes);
  if (!engine && estimatedVramBytes === '0' && estimatedRamBytes === '0' && estimatedDiskBytes === '0') {
    return undefined;
  }
  return {
    estimatedVramBytes,
    estimatedRamBytes,
    estimatedDiskBytes,
    engine,
  };
}

function fromRuntimeSchedulingTarget(
  target: SchedulingEvaluationTarget | undefined,
): NimiAISchedulingEvaluationTarget {
  return {
    capability: normalizeText(target?.capability),
    targetId: normalizeText(target?.targetId) || null,
    profileId: normalizeText(target?.profileId) || null,
    resourceHint: fromRuntimeResourceHint(target?.resourceHint),
  };
}

function fromRuntimeResourceHint(
  hint: SchedulingResourceHint | undefined,
): NimiAISchedulingResourceHint | null {
  if (!hint) {
    return null;
  }
  const engine = normalizeText(hint.engine);
  const estimatedVramBytes = normalizeInt64(hint.estimatedVramBytes);
  const estimatedRamBytes = normalizeInt64(hint.estimatedRamBytes);
  const estimatedDiskBytes = normalizeInt64(hint.estimatedDiskBytes);
  if (!engine && estimatedVramBytes === '0' && estimatedRamBytes === '0' && estimatedDiskBytes === '0') {
    return null;
  }
  return {
    estimatedVramBytes,
    estimatedRamBytes,
    estimatedDiskBytes,
    engine,
  };
}

function projectSchedulingOccupancy(
  occupancy: SchedulingOccupancySnapshot | undefined,
): NimiAISchedulingOccupancy | null {
  if (!occupancy) {
    return null;
  }
  return {
    globalUsed: Number(occupancy.globalUsed) || 0,
    globalCap: Number(occupancy.globalCap) || 0,
    appUsed: Number(occupancy.appUsed) || 0,
    appCap: Number(occupancy.appCap) || 0,
  };
}

function unknownSchedulingJudgement(): NimiAISchedulingJudgement {
  return {
    state: 'unknown',
    detail: null,
    occupancy: null,
    resourceWarnings: [],
  };
}

function getSchedulingClient(
  runtime: NimiRuntimeAISchedulingClientOptions['runtime'],
): NimiRuntimeAISchedulingClient {
  if (isSchedulingClient(runtime)) {
    return runtime;
  }
  const container = runtime as {
    readonly scheduling?: NimiRuntimeAISchedulingClient;
    readonly generated?: NimiRuntimeAISchedulingClient;
  };
  if (container.scheduling && isSchedulingClient(container.scheduling)) {
    return container.scheduling;
  }
  if (container.generated && isSchedulingClient(container.generated)) {
    return container.generated;
  }
  throw schedulingError(
    'SDK_AI_SCHEDULING_RUNTIME_REQUIRED',
    'Runtime AI scheduling requires a Runtime peekScheduling client',
    'provide_runtime_scheduling_client',
  );
}

function isSchedulingClient(value: unknown): value is NimiRuntimeAISchedulingClient {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && 'peekScheduling' in value
    && typeof (value as { readonly peekScheduling?: unknown }).peekScheduling === 'function';
}

function normalizeInt64(value: string | number | bigint | null | undefined): string {
  if (value === undefined || value === null || value === '') {
    return '0';
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) {
    throw schedulingError(
      'SDK_AI_SCHEDULING_RESOURCE_HINT_INVALID',
      `scheduling resource hint bytes must be an integer string, got ${text}`,
      'provide_integer_byte_count',
    );
  }
  return text;
}

function requireText(value: unknown, message: string, actionHint: string): string {
  const text = normalizeText(value);
  if (!text) {
    throw schedulingError('SDK_AI_SCHEDULING_FIELD_REQUIRED', message, actionHint);
  }
  return text;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function schedulingError(code: string, message: string, actionHint: string): Error {
  return createNimiError({
    message,
    code,
    reasonCode: code,
    actionHint,
    source: 'sdk',
  });
}
