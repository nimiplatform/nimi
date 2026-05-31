import { getPlatformClient } from '@nimiplatform/sdk';
import {
  normalizeSchedulingTarget,
  peekAggregateSchedulingJudgement as peekSdkAggregateSchedulingJudgement,
  peekSchedulingBatch as peekSdkSchedulingBatch,
  resolveAIConfigScopeSchedulingTargets,
  resolveAIConfigSchedulingTargetForCapability,
  schedulingTargetsEqual,
  type AIConfigSchedulingBatchPeekResult,
  type AISchedulingEvaluationTarget,
  type AISchedulingJudgement,
} from '@nimiplatform/sdk/ai';

export {
  normalizeSchedulingTarget,
  resolveAIConfigScopeSchedulingTargets,
  resolveAIConfigSchedulingTargetForCapability,
  schedulingTargetsEqual,
};

export async function peekSchedulingBatch(
  runtimePackageId: string,
  appId: string,
  targets: AISchedulingEvaluationTarget[],
): Promise<AIConfigSchedulingBatchPeekResult | null> {
  void runtimePackageId;
  return peekSdkSchedulingBatch({
    appId,
    targets,
    peekScheduling: (request, options) =>
      getPlatformClient().runtime.ai.peekScheduling(request, options),
  });
}

export async function peekAggregateSchedulingJudgement(
  runtimePackageId: string,
  appId: string,
  targets: AISchedulingEvaluationTarget[],
): Promise<AISchedulingJudgement | null> {
  void runtimePackageId;
  return peekSdkAggregateSchedulingJudgement({
    appId,
    targets,
    peekScheduling: (request, options) =>
      getPlatformClient().runtime.ai.peekScheduling(request, options),
  });
}
