import type { AISchedulingEvaluationTarget } from './runtime-scheduling-types.js';

export type RuntimeSchedulingAIConfigTargetRef = {
  readonly kind?: string | null;
  readonly targetId?: string | null;
  readonly profileId?: string | null;
  readonly readinessRef?: string | null;
};

export type RuntimeSchedulingAIConfigLike = {
  readonly capabilities?: {
    readonly targetRefs?: Partial<Record<string, RuntimeSchedulingAIConfigTargetRef | null | undefined>>;
  } | null;
};

/**
 * Project scope-owned AIConfig local bindings into Runtime scheduling targets.
 *
 * This is SDK DX over the Runtime scheduling public surface: it does not
 * evaluate scheduling, infer readiness, choose routes, or persist execution
 * truth. Runtime remains the authority for Peek judgement materialization.
 */
export function resolveAIConfigRuntimeSchedulingTargets(
  config: RuntimeSchedulingAIConfigLike,
): AISchedulingEvaluationTarget[] {
  const targets: AISchedulingEvaluationTarget[] = [];
  const targetRefs = config.capabilities?.targetRefs || {};
  const capabilities = Object.keys(targetRefs).sort((left, right) => left.localeCompare(right));
  for (const capability of capabilities) {
    const ref = targetRefs[capability];
    if (!ref || ref.kind !== 'local_runtime_target_ref') {
      continue;
    }
    targets.push({
      capability,
      targetId: ref?.targetId || null,
      profileId: ref?.profileId || null,
      resourceHint: null,
    });
  }
  return targets;
}

export function resolveAIConfigRuntimeSchedulingTargetForCapability(
  config: RuntimeSchedulingAIConfigLike,
  capability: string,
): AISchedulingEvaluationTarget | null {
  const ref = config.capabilities?.targetRefs?.[capability];
  if (!ref || ref.kind !== 'local_runtime_target_ref') {
    return null;
  }
  return {
    capability,
    targetId: ref?.targetId || null,
    profileId: ref?.profileId || null,
    resourceHint: null,
  };
}
