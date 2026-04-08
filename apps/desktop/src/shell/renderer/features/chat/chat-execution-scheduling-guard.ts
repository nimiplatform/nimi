import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type {
  AIConfigSDKSurface,
  AISchedulingEvaluationTarget,
  AISchedulingJudgement,
  AISchedulingState,
  AIScopeRef,
} from '@nimiplatform/sdk/mod';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';

export type ExecutionSchedulingGuardDecision = {
  judgement: AISchedulingJudgement | null;
  disabled: boolean;
  disabledReason: string | null;
  feedback: InlineFeedbackState | null;
};

export function schedulingTitleKey(state: AISchedulingState): string {
  switch (state) {
    case 'denied': return 'Chat.schedulingDeniedTitle';
    case 'queue_required': return 'Chat.schedulingQueueRequiredTitle';
    case 'preemption_risk': return 'Chat.schedulingPreemptionRiskTitle';
    case 'slowdown_risk': return 'Chat.schedulingSlowdownRiskTitle';
    default: return 'Chat.schedulingUnknownTitle';
  }
}

export function schedulingDetailKey(state: AISchedulingState): string {
  switch (state) {
    case 'denied': return 'Chat.schedulingDeniedDetail';
    case 'queue_required': return 'Chat.schedulingQueueRequiredDetail';
    case 'preemption_risk': return 'Chat.schedulingPreemptionRiskDetail';
    case 'slowdown_risk': return 'Chat.schedulingSlowdownRiskDetail';
    default: return 'Chat.schedulingUnknownDetail';
  }
}

function formatSchedulingDetail(
  t: TFunction,
  judgement: AISchedulingJudgement,
): string {
  return t(schedulingDetailKey(judgement.state), { detail: judgement.detail || '' });
}

export function resolveExecutionSchedulingGuardDecision(input: {
  judgement: AISchedulingJudgement | null;
  t: TFunction;
}): ExecutionSchedulingGuardDecision {
  const { judgement, t } = input;
  if (!judgement || judgement.state === 'runnable') {
    return {
      judgement,
      disabled: false,
      disabledReason: null,
      feedback: null,
    };
  }

  const detail = formatSchedulingDetail(t, judgement);
  switch (judgement.state) {
    case 'denied':
      return {
        judgement,
        disabled: true,
        disabledReason: detail,
        feedback: {
          kind: 'error',
          message: detail,
        },
      };
    case 'queue_required':
      return {
        judgement,
        disabled: false,
        disabledReason: null,
        feedback: {
          kind: 'info',
          message: detail,
        },
      };
    case 'preemption_risk':
    case 'slowdown_risk':
    case 'unknown':
      return {
        judgement,
        disabled: false,
        disabledReason: null,
        feedback: {
          kind: 'warning',
          message: detail,
        },
      };
  }
}

export async function probeExecutionSchedulingGuard(input: {
  scopeRef: AIScopeRef;
  target: AISchedulingEvaluationTarget | null;
  t: TFunction;
  surface?: Pick<AIConfigSDKSurface, 'aiConfig'>;
}): Promise<ExecutionSchedulingGuardDecision> {
  const surface = input.surface ?? getDesktopAIConfigService();
  return resolveExecutionSchedulingGuardDecision({
    judgement: input.target
      ? await surface.aiConfig.probeSchedulingTarget(input.scopeRef, input.target)
      : null,
    t: input.t,
  });
}

export function useSchedulingFeasibility(): AISchedulingJudgement | null {
  const surface = useMemo(() => getDesktopAIConfigService(), []);
  const scopeRef = useAppStore((state) => state.aiConfig.scopeRef);

  const { data } = useQuery({
    queryKey: [
      'scheduling-feasibility',
      scopeRef.ownerId,
      scopeRef.kind,
      scopeRef.surfaceId ?? '',
    ],
    queryFn: async () => {
      const result = await surface.aiConfig.probeFeasibility(scopeRef);
      return result.schedulingJudgement ?? null;
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  return data ?? null;
}
