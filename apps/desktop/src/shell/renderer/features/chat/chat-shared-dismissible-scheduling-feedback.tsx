import { useCallback, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import type { NimiAISchedulingJudgement } from '@nimiplatform/sdk/ai';
import { InlineFeedback } from '../../ui/feedback/inline-feedback';
import {
  resolveExecutionSchedulingGuardDecision,
} from './chat-shared-execution-scheduling-guard';

export function useDismissibleSchedulingFeedback(input: {
  judgement: NimiAISchedulingJudgement | null;
  t: TFunction;
}) {
  const guard = useMemo(
    () => resolveExecutionSchedulingGuardDecision({
      judgement: input.judgement,
      t: input.t,
    }),
    [input.judgement, input.t],
  );
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const feedbackKey = guard.feedback?.message ?? null;
  const onDismiss = useCallback(() => {
    setDismissedKey(feedbackKey);
  }, [feedbackKey]);
  const feedbackNode = guard.feedback && feedbackKey !== dismissedKey ? (
    <InlineFeedback feedback={guard.feedback} onDismiss={onDismiss} />
  ) : null;

  return {
    guard,
    feedbackNode,
  };
}
