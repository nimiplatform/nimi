import { isNimiError, type NimiError } from '@nimiplatform/sdk/types';

export function nimiFailureDetails(error: unknown): Pick<
  NimiError, 'message' | 'reasonCode' | 'actionHint' | 'retryable'
> | null {
  if (!isNimiError(error)) return null;
  return {
    message: error.message,
    reasonCode: error.reasonCode,
    actionHint: error.actionHint,
    retryable: error.retryable,
  };
}
