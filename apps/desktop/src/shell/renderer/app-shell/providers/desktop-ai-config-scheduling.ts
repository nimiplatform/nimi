import { createModRuntimeClient } from '@nimiplatform/sdk/mod';
import type {
  AIConfig,
  AISchedulingEvaluationTarget,
  AISchedulingJudgement,
  AISchedulingState,
} from '@nimiplatform/sdk/mod';

export function resolveAIConfigScopeSchedulingTargets(
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
      modId: ref?.modId || null,
      profileId: ref?.profileId || null,
      resourceHint: null,
    });
  }
  return targets;
}

export function resolveAIConfigSchedulingTargetForCapability(
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
    modId: ref?.modId || null,
    profileId: ref?.profileId || null,
    resourceHint: null,
  };
}

const VALID_SCHEDULING_STATES: AISchedulingState[] = [
  'runnable', 'queue_required', 'preemption_risk', 'slowdown_risk', 'denied', 'unknown',
];

type SchedulingBatchPeekResult = {
  occupancy: AISchedulingJudgement['occupancy'];
  aggregateJudgement: AISchedulingJudgement | null;
  targetJudgements: Array<{
    target: AISchedulingEvaluationTarget;
    judgement: AISchedulingJudgement;
  }>;
};

export function normalizeSchedulingTarget(
  target: AISchedulingEvaluationTarget | null | undefined,
): AISchedulingEvaluationTarget | null {
  if (!target) {
    return null;
  }
  const capability = String(target.capability || '').trim();
  if (!capability) {
    return null;
  }
  return {
    capability,
    modId: String(target.modId || '').trim() || null,
    profileId: String(target.profileId || '').trim() || null,
    resourceHint: target.resourceHint ? {
      estimatedVramBytes: target.resourceHint.estimatedVramBytes ?? null,
      estimatedRamBytes: target.resourceHint.estimatedRamBytes ?? null,
      estimatedDiskBytes: target.resourceHint.estimatedDiskBytes ?? null,
      engine: target.resourceHint.engine ?? null,
    } : null,
  };
}

export function schedulingTargetsEqual(
  left: AISchedulingEvaluationTarget,
  right: AISchedulingEvaluationTarget,
): boolean {
  return left.capability === right.capability
    && (left.modId || null) === (right.modId || null)
    && (left.profileId || null) === (right.profileId || null);
}

function toSchedulingJudgement(value: {
  state: string;
  detail: string;
  occupancy: { globalUsed: number; globalCap: number; appUsed: number; appCap: number } | null;
  resourceWarnings: string[];
} | null | undefined): AISchedulingJudgement | null {
  if (!value) {
    return null;
  }
  const state = VALID_SCHEDULING_STATES.includes(value.state as AISchedulingState)
    ? value.state as AISchedulingState
    : 'unknown';
  return {
    state,
    detail: value.detail || null,
    occupancy: value.occupancy,
    resourceWarnings: value.resourceWarnings || [],
  };
}

export async function peekSchedulingBatch(
  runtimeModId: string,
  appId: string,
  targets: AISchedulingEvaluationTarget[],
): Promise<SchedulingBatchPeekResult | null> {
  const normalizedTargets = targets
    .map((target) => normalizeSchedulingTarget(target))
    .filter((target): target is AISchedulingEvaluationTarget => target !== null);
  if (normalizedTargets.length === 0) {
    return null;
  }
  try {
    const client = createModRuntimeClient(runtimeModId);
    const peekResult = await client.scheduler.peek({
      appId,
      targets: normalizedTargets,
    });
    return {
      occupancy: peekResult.occupancy,
      aggregateJudgement: toSchedulingJudgement(peekResult.aggregateJudgement),
      targetJudgements: (peekResult.targetJudgements || [])
        .map((entry) => {
          const target = normalizeSchedulingTarget(entry.target);
          const judgement = toSchedulingJudgement(entry.judgement);
          if (!target || !judgement) {
            return null;
          }
          return { target, judgement };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    };
  } catch {
    // Runtime Peek RPC not available — honest null per D-AIPC-012.
    return null;
  }
}

export async function peekAggregateSchedulingJudgement(
  runtimeModId: string,
  appId: string,
  targets: AISchedulingEvaluationTarget[],
): Promise<AISchedulingJudgement | null> {
  const batchResult = await peekSchedulingBatch(runtimeModId, appId, targets);
  return batchResult?.aggregateJudgement ?? null;
}
