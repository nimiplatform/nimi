import {
  createNimiRuntimeAISchedulingClient,
  normalizeNimiAISchedulingTarget,
  resolveNimiAIConfigRuntimeSchedulingTargetForCapability,
  resolveNimiAIConfigRuntimeSchedulingTargets,
  nimiAISchedulingTargetsEqual,
  type NimiAIConfig,
  type NimiAISchedulingEvaluationTarget,
  type NimiAISchedulingJudgement,
  type NimiAISchedulingProjection,
} from '@nimiplatform/sdk/ai';
import { getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';

export {
  normalizeNimiAISchedulingTarget,
  resolveNimiAIConfigRuntimeSchedulingTargetForCapability,
  resolveNimiAIConfigRuntimeSchedulingTargets,
  nimiAISchedulingTargetsEqual,
};

export async function peekDesktopRuntimeSchedulingBatch(
  _runtimePackageId: string,
  appId: string,
  targets: readonly NimiAISchedulingEvaluationTarget[],
): Promise<NimiAISchedulingProjection | null> {
  const normalizedTargets = targets
    .map((target) => normalizeNimiAISchedulingTarget(target))
    .filter((target): target is NimiAISchedulingEvaluationTarget => target !== null);
  if (normalizedTargets.length === 0) {
    return null;
  }
  const scheduling = createNimiRuntimeAISchedulingClient({
    runtime: getDesktopRuntime(),
    appId,
    targets: normalizedTargets,
  });
  return scheduling.peek();
}

export async function peekDesktopRuntimeAggregateSchedulingJudgement(
  runtimePackageId: string,
  appId: string,
  targets: readonly NimiAISchedulingEvaluationTarget[],
): Promise<NimiAISchedulingJudgement | null> {
  const batchResult = await peekDesktopRuntimeSchedulingBatch(runtimePackageId, appId, targets);
  return batchResult?.aggregateJudgement ?? null;
}

export function resolveDesktopAIConfigRuntimeSchedulingTargets(
  config: NimiAIConfig,
): readonly NimiAISchedulingEvaluationTarget[] {
  return resolveNimiAIConfigRuntimeSchedulingTargets(config);
}
