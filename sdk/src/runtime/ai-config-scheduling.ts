import type { AIConfig } from '../ai/index.js';
import type { AISchedulingEvaluationTarget } from './runtime-scheduling-types.js';

/**
 * Project scope-owned AIConfig local bindings into Runtime scheduling targets.
 *
 * This is SDK DX over the AIConfig typed surface: it does not evaluate
 * scheduling, infer Runtime readiness, or persist execution truth. Runtime
 * remains the authority for Peek judgement materialization.
 */
export function resolveAIConfigRuntimeSchedulingTargets(
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

export function resolveAIConfigRuntimeSchedulingTargetForCapability(
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
