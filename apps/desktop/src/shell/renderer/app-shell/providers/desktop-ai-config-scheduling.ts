import type {
  AIConfig,
  AISchedulingEvaluationTarget,
  AISchedulingJudgement,
} from '@nimiplatform/sdk/ai';

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

export async function peekSchedulingBatch(
  runtimeModId: string,
  appId: string,
  targets: AISchedulingEvaluationTarget[],
): Promise<SchedulingBatchPeekResult | null> {
  void runtimeModId;
  void appId;
  const normalizedTargets = targets
    .map((target) => normalizeSchedulingTarget(target))
    .filter((target): target is AISchedulingEvaluationTarget => target !== null);
  if (normalizedTargets.length === 0) {
    return null;
  }
  return null;
}

export async function peekAggregateSchedulingJudgement(
  runtimeModId: string,
  appId: string,
  targets: AISchedulingEvaluationTarget[],
): Promise<AISchedulingJudgement | null> {
  const batchResult = await peekSchedulingBatch(runtimeModId, appId, targets);
  return batchResult?.aggregateJudgement ?? null;
}
