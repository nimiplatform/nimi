import type { JsonObject } from '../internal/utils.js';
import { ReasonCode } from '../types/index.js';
import { asNimiError, createNimiError } from '../core/errors.js';
import type { NimiError } from '../types/index.js';
import type {
  RealmConnectionState,
  RealmOptions,
} from './client-types.js';
import type { RealmRawRequestInput } from './generated/service-registry.js';
import {
  DEFAULT_REALM_TIMEOUT_MS,
  asRecord,
  extractResponseReasonCode,
  hasValue,
  isResponse,
  mapRealmError,
  normalizeText,
  readErrorBody,
} from './client-helpers.js';
import {
  REALM_HTTP_METHODS,
  encodePathValue,
  getOpenApiMethod,
  resolvePositiveTimeoutMs,
} from './client-request-utils.js';
import {
  resolveRealmRetryDelay,
  sleepForRealmRetry,
} from './client-retry.js';
import type { RealmAuthState } from './client-auth.js';
import { assertNoAuthRealmEndpointAllowed } from './no-auth-allowlist.js';

export type RealmRequestRunnerDeps = {
  openapiClient: Record<string, unknown>;
  options: RealmOptions;
  authState: RealmAuthState;
  getStateStatus: () => RealmConnectionState['status'];
  connect: () => Promise<void>;
  emitError: (error: NimiError) => void;
  emitTelemetry: (name: string, data?: JsonObject) => void;
  emitRequestSuccess: (method: string, path: string, httpStatus?: number) => void;
};

export async function requestRealmUnknown(
  input: RealmRawRequestInput,
  deps: RealmRequestRunnerDeps,
): Promise<unknown> {
  if (deps.getStateStatus() === 'idle') {
    await deps.connect();
  }

  let path = normalizeText(input.path);
  if (!path) {
    throw createNimiError({
      message: 'realm path is required',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'set_realm_request_path',
      source: 'sdk',
    });
  }
  if (input.pathParams) {
    for (const [key, value] of Object.entries(input.pathParams)) {
      const placeholder = `{${key}}`;
      if (!path.includes(placeholder)) {
        continue;
      }
      path = path.replaceAll(placeholder, encodePathValue(value));
    }
  }

  const timeoutMs = resolvePositiveTimeoutMs(
    input.timeoutMs ?? deps.options.timeoutMs,
    DEFAULT_REALM_TIMEOUT_MS,
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutController = timeoutMs > 0 ? new AbortController() : undefined;
  let timeoutTriggered = false;
  let externalAbortTriggered = false;
  let refreshAttempted = false;
  let retryAttempt = 0;
  let refreshFailure: NimiError | null = null;

  try {
    if (timeoutController) {
      timer = setTimeout(() => {
        timeoutController.abort();
      }, timeoutMs);
    }

    const methodName = normalizeText(input.method).toUpperCase();
    const method = getOpenApiMethod(
      deps.openapiClient,
      methodName,
    );

    if (method === null) {
      throw createNimiError({
        message: `unsupported realm HTTP method: ${methodName || '(empty)'}; supported methods: ${REALM_HTTP_METHODS.join(', ')}`,
        reasonCode: ReasonCode.ACTION_INPUT_INVALID,
        actionHint: 'check_realm_request_method',
        source: 'sdk',
      });
    }

    let accessToken = await deps.authState.resolveAccessToken();
    assertNoAuthRealmEndpointAllowed({ accessToken, methodName, path });
    while (true) {
      const requestAbortController = new AbortController();
      const abortRequest = () => {
        if (!requestAbortController.signal.aborted) {
          requestAbortController.abort();
        }
      };
      const onTimeoutAbort = () => {
        timeoutTriggered = true;
        abortRequest();
      };
      const onExternalAbort = () => {
        externalAbortTriggered = true;
        abortRequest();
      };
      timeoutController?.signal.addEventListener('abort', onTimeoutAbort, { once: true });
      if (timeoutController?.signal.aborted) {
        onTimeoutAbort();
      }
      if (input.signal) {
        if (input.signal.aborted) {
          onExternalAbort();
        } else {
          input.signal.addEventListener('abort', onExternalAbort, { once: true });
        }
      }
      const headers = await deps.authState.resolveHeaders(input.headers, accessToken);
      try {
        const responseTuple = await method(
          path,
          {
            params: input.query ? { query: input.query } : undefined,
            body: input.body,
            headers,
            signal: requestAbortController.signal,
          },
        );

        const responseTupleRecord = asRecord(responseTuple);
        const response = responseTupleRecord.response;
        const errorPayload = responseTupleRecord.error;
        const dataPayload = responseTupleRecord.data;

        if (isResponse(response)) {
          if (!response.ok) {
            if (
              !refreshAttempted
              && response.status === 401
              && deps.options.auth?.mode === 'external_principal'
              && deps.options.auth.refreshToken
            ) {
              try {
                const refreshResult = await deps.authState.refreshAccessTokenForRetry();
                refreshAttempted = true;
                accessToken = refreshResult.accessToken;
                deps.emitTelemetry('realm.token_refreshed');
                retryAttempt += 1;
                continue;
              } catch (refreshError) {
                refreshFailure = asNimiError(refreshError, { source: 'realm' });
              }
            }

            const retryDelayMs = resolveRealmRetryDelay(response, retryAttempt, deps.options.retry);
            if (retryDelayMs !== null) {
              retryAttempt += 1;
              await sleepForRealmRetry(retryDelayMs, requestAbortController.signal);
              continue;
            }

            const bodyRecord = readErrorBody(errorPayload);
            const mapped = extractResponseReasonCode(bodyRecord, response);
            throw createNimiError({
              message: mapped.message,
              code: mapped.code,
              reasonCode: mapped.reasonCode,
              actionHint: mapped.actionHint,
              traceId: mapped.traceId || undefined,
              retryable: mapped.retryable,
              source: 'realm',
              details: refreshFailure?.details
                ? {
                    ...mapped.details,
                    refreshFailureReasonCode: refreshFailure.reasonCode,
                    refreshFailureMessage: refreshFailure.message,
                    ...refreshFailure.details,
                  }
                : mapped.details,
            });
          }

          if (hasValue(dataPayload)) {
            deps.emitRequestSuccess(methodName, path, response.status);
            return dataPayload;
          }

          if (response.status === 204) {
            deps.emitRequestSuccess(methodName, path, response.status);
            return undefined;
          }

          const contentType = normalizeText(response.headers.get('content-type')).toLowerCase();
          if (contentType.includes('application/json')) {
            const json = await response.json();
            deps.emitRequestSuccess(methodName, path, response.status);
            return json;
          }
          const text = await response.text();
          deps.emitRequestSuccess(methodName, path, response.status);
          return text;
        }

        if (hasValue(errorPayload)) {
          throw errorPayload;
        }

        if (hasValue(dataPayload)) {
          deps.emitRequestSuccess(methodName, path);
          return dataPayload;
        }

        deps.emitRequestSuccess(methodName, path);
        return responseTuple;
      } finally {
        timeoutController?.signal.removeEventListener('abort', onTimeoutAbort);
        if (input.signal) {
          input.signal.removeEventListener('abort', onExternalAbort);
        }
      }
    }
  } catch (error) {
    const mapped = timeoutTriggered
      ? createNimiError({
        message: `realm request timeout after ${timeoutMs}ms`,
        code: ReasonCode.REALM_UNAVAILABLE,
        reasonCode: ReasonCode.REALM_UNAVAILABLE,
        actionHint: 'retry_after_backoff',
        source: 'realm',
        retryable: true,
        details: { timeoutMs },
      })
      : externalAbortTriggered
        ? createNimiError({
          message: normalizeText(asRecord(error).message) || 'realm request aborted',
          code: ReasonCode.OPERATION_ABORTED,
          reasonCode: ReasonCode.OPERATION_ABORTED,
          actionHint: 'retry_if_needed',
          source: 'realm',
          retryable: false,
        })
        : mapRealmError(error);
    deps.emitError(mapped);
    deps.emitTelemetry('realm.error', {
      reasonCode: mapped.reasonCode,
      actionHint: mapped.actionHint,
      traceId: mapped.traceId,
    });
    throw mapped;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
