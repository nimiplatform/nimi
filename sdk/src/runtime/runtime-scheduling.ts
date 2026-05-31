import type {
  AISchedulingEvaluationTarget,
  AISchedulingJudgement,
  AISchedulingOccupancy,
  AISchedulingResourceHint,
  AISchedulingState,
} from './runtime-scheduling-types.js';
import type { AIConfig } from '../ai/ai-config.js';

export type RuntimeSchedulingEvaluationTargetInput = {
  capability: string;
  targetId: string;
  profileId: string;
  resourceHint?: {
    estimatedVramBytes: string;
    estimatedRamBytes: string;
    estimatedDiskBytes: string;
    engine: string;
  };
};

export type RuntimeSchedulingPeekRequestInput = {
  appId: string;
  targets: RuntimeSchedulingEvaluationTargetInput[];
};

export type RuntimeSchedulingPeekOptions = {
  timeoutMs?: number;
};

type RuntimeSchedulingOccupancyLike = {
  globalUsed?: unknown;
  globalCap?: unknown;
  appUsed?: unknown;
  appCap?: unknown;
};

type RuntimeSchedulingJudgementLike = {
  state?: unknown;
  detail?: unknown;
  occupancy?: RuntimeSchedulingOccupancyLike;
  resourceWarnings?: unknown;
};

type RuntimeSchedulingTargetJudgementLike = {
  target?: {
    capability?: unknown;
    targetId?: unknown;
    profileId?: unknown;
    resourceHint?: {
      estimatedVramBytes?: unknown;
      estimatedRamBytes?: unknown;
      estimatedDiskBytes?: unknown;
      engine?: unknown;
    };
  };
  judgement?: RuntimeSchedulingJudgementLike;
};

export type RuntimeSchedulingPeekResponseLike = {
  occupancy?: RuntimeSchedulingOccupancyLike;
  aggregateJudgement?: RuntimeSchedulingJudgementLike;
  targetJudgements?: RuntimeSchedulingTargetJudgementLike[];
};

export type RuntimeSchedulingPeek = (
  request: RuntimeSchedulingPeekRequestInput,
  options?: RuntimeSchedulingPeekOptions,
) => Promise<RuntimeSchedulingPeekResponseLike>;

export type RuntimeSchedulingBatchPeekResult = {
  occupancy: AISchedulingOccupancy | null;
  aggregateJudgement: AISchedulingJudgement;
  targetJudgements: Array<{
    target: AISchedulingEvaluationTarget;
    judgement: AISchedulingJudgement;
  }>;
};

function int64String(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(Math.trunc(numeric)) : '0';
}

function trimmed(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeSchedulingResourceHint(
  hint: AISchedulingResourceHint | null | undefined,
): AISchedulingResourceHint | null {
  if (!hint) {
    return null;
  }
  return {
    estimatedVramBytes: hint.estimatedVramBytes ?? null,
    estimatedRamBytes: hint.estimatedRamBytes ?? null,
    estimatedDiskBytes: hint.estimatedDiskBytes ?? null,
    engine: hint.engine ?? null,
  };
}

function toRuntimeSchedulingResourceHint(
  hint: AISchedulingResourceHint | null | undefined,
): RuntimeSchedulingEvaluationTargetInput['resourceHint'] {
  const normalized = normalizeSchedulingResourceHint(hint);
  if (!normalized) {
    return undefined;
  }
  const engine = trimmed(normalized.engine);
  const hasNumericHint = normalized.estimatedVramBytes !== null
    || normalized.estimatedRamBytes !== null
    || normalized.estimatedDiskBytes !== null;
  if (!engine && !hasNumericHint) {
    return undefined;
  }
  return {
    estimatedVramBytes: int64String(normalized.estimatedVramBytes),
    estimatedRamBytes: int64String(normalized.estimatedRamBytes),
    estimatedDiskBytes: int64String(normalized.estimatedDiskBytes),
    engine,
  };
}

export function resolveRuntimeSchedulingTargetsFromAIConfig(
  config: AIConfig,
): AISchedulingEvaluationTarget[] {
  const localRefs = config.capabilities.localProfileRefs || {};
  const selectedBindings = config.capabilities.selectedBindings || {};
  const targets: AISchedulingEvaluationTarget[] = [];
  const capabilities = Object.keys(selectedBindings).sort((left, right) => left.localeCompare(right));
  for (const capability of capabilities) {
    const binding = selectedBindings[capability];
    if (!binding || binding.source !== 'local') {
      continue;
    }
    const ref = localRefs[capability];
    targets.push({
      capability,
      targetId: ref?.targetId || null,
      profileId: ref?.profileId || null,
      resourceHint: null,
    });
  }
  return targets;
}

export function resolveRuntimeSchedulingTargetForCapability(
  config: AIConfig,
  capability: string,
): AISchedulingEvaluationTarget | null {
  const binding = config.capabilities.selectedBindings?.[capability];
  if (!binding || binding.source !== 'local') {
    return null;
  }
  const ref = config.capabilities.localProfileRefs?.[capability];
  return {
    capability,
    targetId: ref?.targetId || null,
    profileId: ref?.profileId || null,
    resourceHint: null,
  };
}

export function normalizeRuntimeSchedulingTarget(
  target: AISchedulingEvaluationTarget | null | undefined,
): AISchedulingEvaluationTarget | null {
  if (!target) {
    return null;
  }
  const capability = trimmed(target.capability);
  if (!capability) {
    return null;
  }
  return {
    capability,
    targetId: trimmed(target.targetId) || null,
    profileId: trimmed(target.profileId) || null,
    resourceHint: normalizeSchedulingResourceHint(target.resourceHint),
  };
}

export function runtimeSchedulingTargetsEqual(
  left: AISchedulingEvaluationTarget,
  right: AISchedulingEvaluationTarget,
): boolean {
  return left.capability === right.capability
    && (left.targetId || null) === (right.targetId || null)
    && (left.profileId || null) === (right.profileId || null);
}

export function toRuntimeSchedulingPeekTarget(
  target: AISchedulingEvaluationTarget,
): RuntimeSchedulingEvaluationTargetInput {
  return {
    capability: target.capability,
    targetId: target.targetId || '',
    profileId: target.profileId || '',
    ...(toRuntimeSchedulingResourceHint(target.resourceHint)
      ? { resourceHint: toRuntimeSchedulingResourceHint(target.resourceHint) }
      : {}),
  };
}

function parseRuntimeSchedulingState(value: unknown): AISchedulingState {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    switch (numeric) {
      case 1:
        return 'runnable';
      case 2:
        return 'queue_required';
      case 3:
        return 'preemption_risk';
      case 4:
        return 'slowdown_risk';
      case 5:
        return 'denied';
      case 6:
        return 'unknown';
      default:
        return 'unknown';
    }
  }
  switch (trimmed(value).toLowerCase()) {
    case 'runnable':
    case 'scheduling_state_runnable':
    case 'runnable'.toUpperCase():
      return 'runnable';
    case 'queue_required':
    case 'scheduling_state_queue_required':
      return 'queue_required';
    case 'preemption_risk':
    case 'scheduling_state_preemption_risk':
      return 'preemption_risk';
    case 'slowdown_risk':
    case 'scheduling_state_slowdown_risk':
      return 'slowdown_risk';
    case 'denied':
    case 'scheduling_state_denied':
      return 'denied';
    case 'unknown':
    case 'scheduling_state_unknown':
    default:
      return 'unknown';
  }
}

function parseOccupancy(value: RuntimeSchedulingOccupancyLike | null | undefined): AISchedulingOccupancy | null {
  if (!value) {
    return null;
  }
  return {
    globalUsed: Number(value.globalUsed) || 0,
    globalCap: Number(value.globalCap) || 0,
    appUsed: Number(value.appUsed) || 0,
    appCap: Number(value.appCap) || 0,
  };
}

function parseJudgement(value: RuntimeSchedulingJudgementLike | null | undefined): AISchedulingJudgement {
  if (!value || typeof value !== 'object') {
    throw new Error('Runtime PeekScheduling response is missing scheduling judgement');
  }
  return {
    state: parseRuntimeSchedulingState(value.state),
    detail: trimmed(value.detail) || null,
    occupancy: parseOccupancy(value.occupancy),
    resourceWarnings: Array.isArray(value.resourceWarnings)
      ? value.resourceWarnings.map((warning) => trimmed(warning)).filter(Boolean)
      : [],
  };
}

function parseTarget(value: RuntimeSchedulingTargetJudgementLike['target']): AISchedulingEvaluationTarget {
  const normalized = normalizeRuntimeSchedulingTarget({
    capability: trimmed(value?.capability),
    targetId: trimmed(value?.targetId) || null,
    profileId: trimmed(value?.profileId) || null,
    resourceHint: value?.resourceHint
      ? {
        estimatedVramBytes: Number(value.resourceHint.estimatedVramBytes) || null,
        estimatedRamBytes: Number(value.resourceHint.estimatedRamBytes) || null,
        estimatedDiskBytes: Number(value.resourceHint.estimatedDiskBytes) || null,
        engine: trimmed(value.resourceHint.engine) || null,
      }
      : null,
  });
  if (!normalized) {
    throw new Error('Runtime PeekScheduling target judgement is missing target capability');
  }
  return normalized;
}

export function parseRuntimeSchedulingBatchPeekResult(
  response: RuntimeSchedulingPeekResponseLike,
): RuntimeSchedulingBatchPeekResult {
  const aggregateJudgement = parseJudgement(response.aggregateJudgement);
  return {
    occupancy: parseOccupancy(response.occupancy) ?? aggregateJudgement.occupancy,
    aggregateJudgement,
    targetJudgements: (response.targetJudgements || []).map((entry) => ({
      target: parseTarget(entry.target),
      judgement: parseJudgement(entry.judgement),
    })),
  };
}

export async function peekRuntimeSchedulingBatch(input: {
  appId: string;
  targets: AISchedulingEvaluationTarget[];
  peekScheduling: RuntimeSchedulingPeek;
  options?: RuntimeSchedulingPeekOptions;
}): Promise<RuntimeSchedulingBatchPeekResult | null> {
  const normalizedTargets = input.targets
    .map((target) => normalizeRuntimeSchedulingTarget(target))
    .filter((target): target is AISchedulingEvaluationTarget => target !== null);
  if (normalizedTargets.length === 0) {
    return null;
  }
  const response = await input.peekScheduling(
    {
      appId: trimmed(input.appId),
      targets: normalizedTargets.map(toRuntimeSchedulingPeekTarget),
    },
    input.options,
  );
  return parseRuntimeSchedulingBatchPeekResult(response);
}

export async function peekRuntimeAggregateSchedulingJudgement(input: {
  appId: string;
  targets: AISchedulingEvaluationTarget[];
  peekScheduling: RuntimeSchedulingPeek;
  options?: RuntimeSchedulingPeekOptions;
}): Promise<AISchedulingJudgement | null> {
  const batchResult = await peekRuntimeSchedulingBatch(input);
  return batchResult?.aggregateJudgement ?? null;
}
