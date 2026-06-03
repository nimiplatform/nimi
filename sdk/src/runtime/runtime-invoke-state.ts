import type { JsonObject } from '../internal/utils.js';
import { asNimiError } from '../core/errors.js';
import { ReasonCode, type NimiError } from '../types/index.js';
import type {
  RuntimeClient,
  RuntimeConnectionState,
  RuntimeOptions,
} from './types.js';
import { invokeWithRuntimeRetry } from './runtime-infra.js';
import { nowIso } from './runtime-value-utils.js';

export async function invokeRuntimeWithStateTransitions<T>(input: {
  operation: () => Promise<T>;
  options: RuntimeOptions;
  getState: () => RuntimeConnectionState;
  setState: (state: RuntimeConnectionState) => void;
  clearClient: () => void;
  getRetryTransitionEpoch: () => number;
  nextRetryTransitionEpoch: () => number;
  emitConnected: (event: { at: string }) => void;
  emitDisconnected: (event: { at: string; reasonCode?: string }) => void;
  emitError: (event: { error: NimiError; at: string }) => void;
  emitTelemetry: (name: string, data?: JsonObject) => void;
}): Promise<T> {
  let retryEpoch: number | null = null;
  return invokeWithRuntimeRetry({
    operation: input.operation,
    options: input.options,
    normalizeError: (error) => asNimiError(error, {
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_or_check_runtime_status',
      source: 'runtime',
    }),
    onRecovered: (attempt) => {
      const state = input.getState();
      if (state.status === 'closing' || state.status === 'closed') {
        return;
      }
      if (retryEpoch === null || retryEpoch !== input.getRetryTransitionEpoch()) {
        return;
      }
      if (state.status !== 'ready') {
        const at = nowIso();
        input.setState({
          ...state,
          status: 'ready',
          lastReadyAt: at,
        });
        input.emitConnected({ at });
        input.emitTelemetry('runtime.connected', {
          at,
          reason: 'auto_retry_recovered',
          attempt,
        });
      }
    },
    onRetry: (normalized, attempt, backoffMs, maxAttempts) => {
      const state = input.getState();
      if (state.status === 'closing' || state.status === 'closed') {
        return;
      }
      retryEpoch = input.nextRetryTransitionEpoch();
      const at = nowIso();
      input.clearClient();
      const wasReady = state.status === 'ready';
      input.setState({
        ...state,
        status: 'idle',
      });
      if (wasReady) {
        input.emitDisconnected({
          at,
          reasonCode: normalized.reasonCode,
        });
      }
      input.emitTelemetry('runtime.disconnected', {
        at,
        reasonCode: normalized.reasonCode,
        attempt,
      });
      input.emitTelemetry('runtime.retry', {
        attempt,
        maxAttempts,
        backoffMs,
        reasonCode: normalized.reasonCode,
      });
    },
    onTerminalError: (normalized) => {
      const state = input.getState();
      if (
        normalized.reasonCode === ReasonCode.OPERATION_ABORTED
        && (state.status === 'closing' || state.status === 'closed')
      ) {
        return;
      }
      input.emitError({
        error: normalized,
        at: nowIso(),
      });
      input.emitTelemetry('runtime.error', {
        reasonCode: normalized.reasonCode,
        actionHint: normalized.actionHint,
        traceId: normalized.traceId,
      });
    },
  });
}
