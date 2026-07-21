import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type {
  NimiAIScopeRef,
  NimiAISchedulingEvaluationTarget,
  NimiAISchedulingJudgement,
  NimiAISchedulingState,
} from '@nimiplatform/sdk/ai';
import { useAppStore } from '../../app-shell/providers/app-store';
import type { InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import type { Runtime } from '@nimiplatform/sdk/runtime';
import type { DesktopRendererAIConfigPort } from '../../renderer/ai-config-port.js';

export type ExecutionSchedulingGuardDecision = {
  judgement: NimiAISchedulingJudgement | null;
  disabled: boolean;
  disabledReason: string | null;
  feedback: InlineFeedbackState | null;
};

const ACTIVE_EXECUTION_SLOWDOWN_WARNING = 'active local executions currently occupy scheduler slots';

export function schedulingTitleKey(state: NimiAISchedulingState): string {
  switch (state) {
    case 'denied': return 'Chat.schedulingDeniedTitle';
    case 'queue_required': return 'Chat.schedulingQueueRequiredTitle';
    case 'preemption_risk': return 'Chat.schedulingPreemptionRiskTitle';
    case 'slowdown_risk': return 'Chat.schedulingSlowdownRiskTitle';
    default: return 'Chat.schedulingUnknownTitle';
  }
}

export function schedulingDetailKey(state: NimiAISchedulingState): string {
  switch (state) {
    case 'denied': return 'Chat.schedulingDeniedDetail';
    case 'queue_required': return 'Chat.schedulingQueueRequiredDetail';
    case 'preemption_risk': return 'Chat.schedulingPreemptionRiskDetail';
    case 'slowdown_risk': return 'Chat.schedulingSlowdownRiskDetail';
    default: return 'Chat.schedulingUnknownDetail';
  }
}

export function isBusySlowdownRisk(judgement: NimiAISchedulingJudgement): boolean {
  return judgement.state === 'slowdown_risk'
    && judgement.resourceWarnings.includes(ACTIVE_EXECUTION_SLOWDOWN_WARNING);
}

export function schedulingDetailKeyForJudgement(judgement: NimiAISchedulingJudgement): string {
  if (isBusySlowdownRisk(judgement)) {
    return 'Chat.schedulingSlowdownRiskBusyDetail';
  }
  return schedulingDetailKey(judgement.state);
}

function formatSchedulingDetail(
  t: TFunction,
  judgement: NimiAISchedulingJudgement,
): string {
  return t(schedulingDetailKeyForJudgement(judgement), { detail: judgement.detail || '' });
}

export function resolveExecutionSchedulingGuardDecision(input: {
  judgement: NimiAISchedulingJudgement | null;
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
  scopeRef: NimiAIScopeRef;
  target: NimiAISchedulingEvaluationTarget | null;
  t: TFunction;
  surface?: Pick<DesktopRendererAIConfigPort, 'aiConfig'>;
  runtime?: Runtime;
}): Promise<ExecutionSchedulingGuardDecision> {
  if (!input.target) {
    return resolveExecutionSchedulingGuardDecision({ judgement: null, t: input.t });
  }
  if (!input.surface) throw new Error('DESKTOP_AI_CONFIG_PORT_REQUIRED');
  return resolveExecutionSchedulingGuardDecision({
    judgement: await input.surface.aiConfig.probeSchedulingTarget(
      input.scopeRef,
      input.target,
      input.runtime,
    ),
    t: input.t,
  });
}

export function useSchedulingFeasibility(): NimiAISchedulingJudgement | null {
  const sdk = useDesktopRendererSdk();
  const surface = useMemo(() => sdk.aiConfig(), [sdk]);
  const scopeRef = useAppStore((state) => state.aiConfig.scopeRef);

  const { data } = useQuery({
    queryKey: [
      'scheduling-feasibility',
      scopeRef.ownerId,
      scopeRef.kind,
      scopeRef.surfaceId ?? '',
    ],
    queryFn: async () => {
      const result = await surface.aiConfig.probeFeasibility(scopeRef, sdk.runtime());
      return result.schedulingJudgement ?? null;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  return data ?? null;
}
