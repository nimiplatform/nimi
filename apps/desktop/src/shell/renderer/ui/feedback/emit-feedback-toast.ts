import { nimiToast } from '@nimiplatform/kit/ui';
import type { InlineFeedbackState } from './inline-feedback';

/**
 * Bridge transient InlineFeedback-shaped operation results into the shared
 * kit/ui toast system. `null` feedback is ignored so callers can forward
 * clear-signals without extra guards.
 */
export function emitFeedbackToast(feedback: InlineFeedbackState | null): void {
  if (!feedback) {
    return;
  }
  nimiToast.show({
    tone: feedback.kind === 'error' ? 'danger' : feedback.kind,
    message: feedback.message,
    action: feedback.actionLabel && feedback.onAction
      ? { label: feedback.actionLabel, onClick: feedback.onAction }
      : undefined,
  });
}
