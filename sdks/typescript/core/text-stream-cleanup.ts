import { isNimiError } from '../types/index.js';

/** Keep the operation failure primary while retaining a failed stream close. */
// @nimi-authority: rule.nimi.sdks.feature-clients.r102
export function withTextStreamCleanupFailure(primary: unknown, cleanup: unknown): unknown {
  if (primary === cleanup) return primary;
  // The model and protected-client layers can observe the same cached close.
  if (primary instanceof AggregateError && primary.errors.includes(cleanup)) return primary;
  const combined = new AggregateError(
    [primary, cleanup],
    primary instanceof Error ? primary.message : 'Text stream failed and cleanup also failed.',
    { cause: primary },
  );
  if (isNimiError(primary)) Object.assign(combined, {
    code: primary.code, reasonCode: primary.reasonCode, actionHint: primary.actionHint,
    traceId: primary.traceId, retryable: primary.retryable, source: primary.source,
    details: primary.details, interruption: primary.interruption,
  });
  return combined;
}
