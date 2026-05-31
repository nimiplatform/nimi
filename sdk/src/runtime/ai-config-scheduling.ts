import type { RuntimeRouteBinding } from './runtime-route.js';
import type { AISchedulingEvaluationTarget } from './runtime-scheduling-types.js';

export type RuntimeSchedulingAIConfigLocalProfileRef = {
  readonly targetId?: string | null;
  readonly profileId?: string | null;
};

export type RuntimeSchedulingAIConfigLike = {
  readonly capabilities?: {
    readonly selectedBindings?: Partial<Record<string, RuntimeRouteBinding | null | undefined>>;
    readonly localProfileRefs?: Partial<Record<string, RuntimeSchedulingAIConfigLocalProfileRef | null | undefined>>;
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
  const localRefs = config.capabilities?.localProfileRefs || {};
  const selectedBindings = config.capabilities?.selectedBindings || {};
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

export function resolveAIConfigRuntimeSchedulingTargetForCapability(
  config: RuntimeSchedulingAIConfigLike,
  capability: string,
): AISchedulingEvaluationTarget | null {
  const binding = config.capabilities?.selectedBindings?.[capability];
  if (!binding || binding.source !== 'local') {
    return null;
  }
  const ref = config.capabilities?.localProfileRefs?.[capability];
  return {
    capability,
    targetId: ref?.targetId || null,
    profileId: ref?.profileId || null,
    resourceHint: null,
  };
}
