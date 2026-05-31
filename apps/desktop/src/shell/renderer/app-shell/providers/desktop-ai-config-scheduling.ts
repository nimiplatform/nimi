import { getPlatformClient } from '@nimiplatform/sdk';
import type {
  AISchedulingEvaluationTarget,
  AISchedulingJudgement,
} from '@nimiplatform/sdk/ai';
import {
  normalizeRuntimeSchedulingTarget,
  peekRuntimeAggregateSchedulingJudgement as peekSdkAggregateSchedulingJudgement,
  peekRuntimeSchedulingBatch as peekSdkSchedulingBatch,
  resolveRuntimeSchedulingTargetsFromAIConfig,
  resolveRuntimeSchedulingTargetForCapability,
  runtimeSchedulingTargetsEqual,
  type RuntimeSchedulingBatchPeekResult,
} from '@nimiplatform/sdk/runtime';

export {
  normalizeRuntimeSchedulingTarget,
  resolveRuntimeSchedulingTargetsFromAIConfig,
  resolveRuntimeSchedulingTargetForCapability,
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
