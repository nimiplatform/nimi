import { getPlatformClient } from '@nimiplatform/sdk';
import {
  normalizeRuntimeSchedulingTarget,
  peekRuntimeAggregateSchedulingJudgement as peekSdkAggregateSchedulingJudgement,
  peekRuntimeSchedulingBatch as peekSdkSchedulingBatch,
  resolveAIConfigRuntimeSchedulingTargetForCapability,
  resolveAIConfigRuntimeSchedulingTargets,
  runtimeSchedulingTargetsEqual,
  type AISchedulingEvaluationTarget,
  type AISchedulingJudgement,
  type RuntimeSchedulingBatchPeekResult,
} from '@nimiplatform/sdk/runtime';

export {
  normalizeRuntimeSchedulingTarget,
  resolveAIConfigRuntimeSchedulingTargetForCapability,
  resolveAIConfigRuntimeSchedulingTargets,
  runtimeSchedulingTargetsEqual,
};

export async function peekDesktopRuntimeSchedulingBatch(
  runtimePackageId: string,
  appId: string,
  targets: AISchedulingEvaluationTarget[],
): Promise<RuntimeSchedulingBatchPeekResult | null> {
  void runtimePackageId;
  return peekSdkSchedulingBatch({
    appId,
    targets,
    peekScheduling: (request, options) =>
      getPlatformClient().runtime.ai.peekScheduling(request, options),
  });
}

export async function peekDesktopRuntimeAggregateSchedulingJudgement(
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
