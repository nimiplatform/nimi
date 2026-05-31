import type { AISchedulingJudgement } from './runtime-scheduling-types.js';

// Runtime-owned execution evidence slice embedded by AIConfig/AISnapshot.
// SDK owns the typed projection and normalization only; Runtime remains the
// authority for scheduling judgement materialization.
export type AIRuntimeEvidence = {
  schedulingJudgement: AISchedulingJudgement | null;
};

export function createAIRuntimeEvidence(input: {
  schedulingJudgement?: AISchedulingJudgement | null;
}): AIRuntimeEvidence | null {
  return input.schedulingJudgement
    ? { schedulingJudgement: input.schedulingJudgement }
    : null;
}

export function projectAIRuntimeEvidenceMetadata(
  evidence: AIRuntimeEvidence | null | undefined,
): Record<string, string> {
  const judgement = evidence?.schedulingJudgement ?? null;
  if (!judgement) {
    return {};
  }
  return {
    runtimeSchedulingState: judgement.state,
    runtimeSchedulingDetail: String(judgement.detail || ''),
  };
}
