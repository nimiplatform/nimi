import { RoutePolicy } from '../core-generated/runtime-protobuf/runtime/v1/ai.js';
import { asNimiError, createNimiError, type JsonObject, type NimiError, type NimiExecutionInterruption } from '../types/index.js';

export const NIMI_OUTCOME_UNCERTAIN_ACTION_HINT = 'confirm_outcome_and_charges_before_new_request';
export const NIMI_LOCAL_OUTCOME_UNCERTAIN_ACTION_HINT = 'confirm_local_execution_before_new_request';
export const NIMI_CALLER_MAY_RESUBMIT_ACTION_HINT = 'resubmit_request';
export const NIMI_PRESENTATION_CANCELED_AFTER_COMPLETION_ACTION_HINT = 'presentation_canceled_after_owner_completion';
export const NIMI_POST_TERMINAL_CLEANUP_ACTION_HINT = 'inspect_stream_cleanup_without_replaying_completed_request';
export const NIMI_OUTCOME_UNCERTAIN_BILLING_NOTICE = 'Original request outcome is unknown and cloud charges may already have accrued. Confirm outcome and charges before starting a new request, which may incur additional charges.';
export const NIMI_LOCAL_OUTCOME_UNCERTAIN_NOTICE = 'Local request ended without terminal confirmation. Do not assume local execution has already stopped before starting a new request.';

export type ImmediateExecutionRoute = 'local' | 'cloud' | 'unknown';

const IMMEDIATE_EXECUTION_METHODS = new Set<string>([
  '/nimi.runtime.v1.RuntimeAiService/ExecuteScenario',
  '/nimi.runtime.v1.RuntimeAiService/StreamScenario',
  '/nimi.runtime.v1.RuntimeAiService/ExecuteLocalAppScenario',
  '/nimi.runtime.v1.RuntimeAiService/StreamLocalAppTextTurn',
]);

// Keep the transport's non-submission observation attached to the error across
// SDK projections. A reason code or message alone cannot establish this fact.
const notSubmittedFailures = new WeakSet<NimiError>();

const TRUSTWORTHY_NON_BILLING_REJECTIONS = new Set<string>([
  'AI_INPUT_INVALID',
  'AI_PROVIDER_AUTH_FAILED',
  'AI_PROVIDER_ENDPOINT_FORBIDDEN',
  'AI_MODEL_NOT_FOUND',
  'AI_MODEL_NOT_READY',
  'AI_PROVIDER_RATE_LIMITED',
  'AI_CONTENT_FILTER_BLOCKED',
  'AI_CONFIG_INVALID',
  'AI_CONFIG_NOT_FOUND',
  'AI_CONFIG_REVISION_CONFLICT',
  'AI_CONNECTOR_CREDENTIAL_MISSING',
  'AI_CONNECTOR_DISABLED',
  'AI_CONNECTOR_NOT_FOUND',
  'AI_REMOTE_MODEL_CATALOG_STALE',
  'CAPABILITY_CATALOG_MISMATCH',
  'AI_LOCAL_CONFIGURATION_NOT_CONFIGURED',
  'AI_LOCAL_MODEL_UNAVAILABLE',
  'AI_MODALITY_NOT_SUPPORTED',
  'AI_MEDIA_OPTION_UNSUPPORTED',
  'AI_TEXT_BEHAVIOR_UNSUPPORTED',
  'AI_ROUTE_UNSUPPORTED',
  'AI_OUTPUT_INVALID',
  'AI_LOCAL_EXECUTION_CANCELED',
  'AI_LOCAL_EXECUTION_OUT_OF_MEMORY',
  'PROTOCOL_ENVELOPE_INVALID',
  'APP_SCOPE_FORBIDDEN',
  'LOCAL_APP_OPERATION_UNAVAILABLE',
  'LOCAL_APP_OPERATION_UNSUPPORTED',
  'AUTH_TOKEN_INVALID',
  'AUTH_TOKEN_EXPIRED',
  'SESSION_EXPIRED',
  'SDK_AI_INPUT_INVALID',
  'SDK_AI_RUNTIME_FEATURE_UNSUPPORTED',
  'SDK_AI_RUNTIME_OUTPUT_INVALID',
  'SDK_LOCAL_APP_INPUT_INVALID',
  'SDK_LOCAL_APP_PROJECTION_INVALID',
  'SDK_TRANSPORT_INVALID',
  'SDK_RUNTIME_METHOD_UNAVAILABLE',
]);

export function isImmediateExecutionMethod(methodId: string): boolean {
  return IMMEDIATE_EXECUTION_METHODS.has(String(methodId || '').trim());
}

export function ensureOutcomeUncertainMessage(message: string): string {
  const trimmed = String(message || '').trim();
  const lower = trimmed.toLowerCase();
  if ((lower.includes('unknown') || lower.includes('uncertain')) && (lower.includes('charge') || lower.includes('bill'))) {
    return trimmed;
  }
  if (!trimmed) {
    return NIMI_OUTCOME_UNCERTAIN_BILLING_NOTICE;
  }
  const normalized = trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
  return `${normalized} ${NIMI_OUTCOME_UNCERTAIN_BILLING_NOTICE}`;
}

export function ensureLocalOutcomeUnknownMessage(message: string): string {
  const trimmed = String(message || '').trim();
  const lower = trimmed.toLowerCase();
  if (lower.includes('do not assume local execution has already stopped')) {
    return trimmed;
  }
  if (!trimmed) {
    return NIMI_LOCAL_OUTCOME_UNCERTAIN_NOTICE;
  }
  const normalized = trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
  return `${normalized} ${NIMI_LOCAL_OUTCOME_UNCERTAIN_NOTICE}`;
}

export function isOutcomeUncertainError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as {
    readonly actionHint?: unknown;
    readonly details?: { readonly route?: unknown };
    readonly interruption?: { readonly resubmitDisposition?: unknown };
  };
  if (record.actionHint === NIMI_LOCAL_OUTCOME_UNCERTAIN_ACTION_HINT || record.details?.route === 'local') {
    return false;
  }
  return record.interruption?.resubmitDisposition === 'outcome-uncertain'
    || record.actionHint === NIMI_OUTCOME_UNCERTAIN_ACTION_HINT;
}

export function isLocalOutcomeUnknownError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as {
    readonly actionHint?: unknown;
    readonly details?: { readonly route?: unknown; readonly outcomeStatus?: unknown };
  };
  return record.actionHint === NIMI_LOCAL_OUTCOME_UNCERTAIN_ACTION_HINT
    || (record.details?.route === 'local' && record.details?.outcomeStatus === 'unknown');
}

function normalizeReasonToken(value: string): string {
  return String(value || '').trim().toUpperCase().replaceAll('-', '_');
}

function isExplicitLocalRouteRequest(requestBody: unknown): boolean {
  if (!requestBody || typeof requestBody !== 'object') {
    return false;
  }
  const head = (requestBody as { readonly head?: unknown }).head;
  if (!head || typeof head !== 'object') {
    return false;
  }
  return (head as { readonly routePolicy?: unknown }).routePolicy === RoutePolicy.LOCAL;
}

function isExplicitCloudRouteRequest(requestBody: unknown): boolean {
  if (!requestBody || typeof requestBody !== 'object') {
    return false;
  }
  const head = (requestBody as { readonly head?: unknown }).head;
  if (!head || typeof head !== 'object') {
    return false;
  }
  return (head as { readonly routePolicy?: unknown }).routePolicy === RoutePolicy.CLOUD;
}

export function resolveImmediateExecutionRoute(
  routePolicy?: RoutePolicy,
  requestBody?: unknown,
): ImmediateExecutionRoute {
  if (routePolicy === RoutePolicy.LOCAL) return 'local';
  if (routePolicy === RoutePolicy.CLOUD) return 'cloud';
  if (isExplicitLocalRouteRequest(requestBody)) return 'local';
  if (isExplicitCloudRouteRequest(requestBody)) return 'cloud';
  return 'unknown';
}

function isTrustworthyNonBillingRejection(error: NimiError): boolean {
  if (error.interruption !== undefined
    || error.actionHint === NIMI_OUTCOME_UNCERTAIN_ACTION_HINT
    || error.actionHint === NIMI_LOCAL_OUTCOME_UNCERTAIN_ACTION_HINT) {
    return false;
  }
  const reason = normalizeReasonToken(error.reasonCode);
  return TRUSTWORTHY_NON_BILLING_REJECTIONS.has(reason)
    || (error.source === 'runtime'
      && error.actionHint === NIMI_CALLER_MAY_RESUBMIT_ACTION_HINT
      && (reason === 'AI_PROVIDER_UNAVAILABLE' || reason === 'AI_PROVIDER_TIMEOUT'));
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as { readonly name?: unknown; readonly reasonCode?: unknown; readonly code?: unknown };
  return record.name === 'AbortError'
    || record.reasonCode === 'OPERATION_ABORTED'
    || record.code === 'OPERATION_ABORTED'
    || record.reasonCode === 'SDK_RUNTIME_REQUEST_CANCELLED';
}

function summarizeCancelReason(reason: unknown): string | undefined {
  if (reason === undefined || reason === null) return undefined;
  if (typeof reason === 'string') {
    const trimmed = reason.trim();
    return trimmed || undefined;
  }
  if (reason instanceof Error) {
    const msg = reason.message.trim();
    return msg || reason.name || undefined;
  }
  if (typeof reason === 'object') {
    const msg = (reason as { readonly message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  }
  return String(reason).trim() || undefined;
}

// @nimi-authority: rule.nimi.sdks.client-core.r021
export function projectImmediateExecutionFailure(
  error: unknown,
  context: {
    readonly methodId: string;
    readonly submitted: boolean;
    readonly requestBody?: unknown;
    readonly observedRoute?: ImmediateExecutionRoute;
    readonly canceled?: boolean;
    readonly cancelReason?: unknown;
    readonly defaultReasonCode?: string;
    readonly defaultActionHint?: string;
    readonly defaultSource?: 'runtime' | 'sdk';
  },
): NimiError {
  const abortLike = Boolean(context.canceled) || isAbortLikeError(error);
  const cancelReason = context.cancelReason !== undefined
    ? context.cancelReason
    : (abortLike ? error : undefined);
  const cancelReasonText = abortLike ? summarizeCancelReason(cancelReason) : undefined;
  const rawCause = cancelReason !== undefined
    ? cancelReason
    : (error instanceof Error && error.cause !== undefined ? error.cause : error);

  const normalized = asNimiError(error, {
    message: abortLike ? (cancelReasonText || 'Operation was canceled.') : undefined,
    reasonCode: abortLike ? 'OPERATION_ABORTED' : (context.defaultReasonCode ?? 'RUNTIME_CALL_FAILED'),
    actionHint: abortLike ? 'retry_if_still_needed' : (context.defaultActionHint ?? 'check_runtime_endpoint_and_network'),
    source: context.defaultSource ?? (abortLike ? 'sdk' : 'runtime'),
    retryable: false,
    ...(rawCause !== undefined ? { cause: rawCause } : {}),
  });

  if (!isImmediateExecutionMethod(context.methodId)) {
    return normalized;
  }

  const route: ImmediateExecutionRoute = context.observedRoute
    ?? resolveImmediateExecutionRoute(undefined, context.requestBody);

  if (normalized.interruption) {
    if (normalized.interruption.resubmitDisposition === 'caller-may-resubmit') {
      return normalized;
    }
    if (route === 'local') {
      return withLocalOutcomeUnknown(normalized, abortLike, cancelReasonText, rawCause);
    }
    return withOutcomeUncertain(normalized, normalized.interruption, route, abortLike, cancelReasonText, rawCause);
  }

  if (normalized.actionHint === NIMI_LOCAL_OUTCOME_UNCERTAIN_ACTION_HINT) {
    return withLocalOutcomeUnknown(normalized, abortLike, cancelReasonText, rawCause);
  }

  if (normalized.actionHint === NIMI_OUTCOME_UNCERTAIN_ACTION_HINT) {
    if (route === 'local') {
      return withLocalOutcomeUnknown(normalized, abortLike, cancelReasonText, rawCause);
    }
    const cause: NimiExecutionInterruption['cause'] = normalizeReasonToken(normalized.reasonCode) === 'AI_EXECUTION_INTERRUPTED'
      ? 'runtime-restart'
      : 'unspecified';
    return withOutcomeUncertain(
      normalized,
      { cause, resubmitDisposition: 'outcome-uncertain' },
      route,
      abortLike,
      cancelReasonText,
      rawCause,
    );
  }

  if (!context.submitted || notSubmittedFailures.has(normalized)) {
    let outcome = normalized;
    if (abortLike && (normalized.details?.canceled !== true || normalized.cause === undefined)) {
      outcome = createNimiError({
        message: normalized.message,
        code: normalized.code,
        reasonCode: normalized.reasonCode,
        actionHint: normalized.actionHint,
        traceId: normalized.traceId,
        retryable: false,
        source: normalized.source,
        details: {
          ...(normalized.details ?? {}),
          canceled: true,
          ...(cancelReasonText ? { cancelReason: cancelReasonText } : {}),
        },
        ...(rawCause !== undefined ? { cause: rawCause } : {}),
      });
    }
    notSubmittedFailures.add(outcome);
    return outcome;
  }

  if (isTrustworthyNonBillingRejection(normalized)) {
    return normalized;
  }

  if (route === 'local') {
    return withLocalOutcomeUnknown(normalized, abortLike, cancelReasonText, rawCause);
  }

  // Request was submitted to Runtime and ended without a trustworthy terminal
  // result; never infer a Runtime restart or safe retry from transport loss.
  return withOutcomeUncertain(
    normalized,
    {
      cause: 'unspecified',
      resubmitDisposition: 'outcome-uncertain',
    },
    route,
    abortLike,
    cancelReasonText,
    rawCause,
  );
}

function withOutcomeUncertain(
  error: NimiError,
  interruption: NimiExecutionInterruption,
  route: ImmediateExecutionRoute,
  canceled: boolean,
  cancelReasonText: string | undefined,
  rawCause: unknown,
): NimiError {
  const details: JsonObject = {
    ...(error.details ?? {}),
    interruption: {
      cause: interruption.cause,
      resubmitDisposition: interruption.resubmitDisposition,
    },
    ...(route === 'cloud' ? { route: 'cloud' } : {}),
    ...(canceled ? { canceled: true } : {}),
    ...(cancelReasonText ? { cancelReason: cancelReasonText } : {}),
  };
  return createNimiError({
    message: ensureOutcomeUncertainMessage(error.message),
    code: error.code,
    reasonCode: error.reasonCode,
    actionHint: NIMI_OUTCOME_UNCERTAIN_ACTION_HINT,
    traceId: error.traceId,
    retryable: false,
    source: error.source,
    details,
    interruption,
    ...(rawCause !== undefined ? { cause: rawCause } : {}),
  });
}

function withLocalOutcomeUnknown(
  error: NimiError,
  canceled: boolean,
  cancelReasonText: string | undefined,
  rawCause: unknown,
): NimiError {
  const details: JsonObject = {
    ...(error.details ?? {}),
    route: 'local',
    outcomeStatus: 'unknown',
    ...(canceled ? { canceled: true } : {}),
    ...(cancelReasonText ? { cancelReason: cancelReasonText } : {}),
  };
  delete details.interruption;
  const cleanedMessage = error.message
    .replace(NIMI_OUTCOME_UNCERTAIN_BILLING_NOTICE, '')
    .trim();
  return createNimiError({
    message: ensureLocalOutcomeUnknownMessage(cleanedMessage || error.reasonCode),
    code: error.code,
    reasonCode: error.reasonCode,
    actionHint: NIMI_LOCAL_OUTCOME_UNCERTAIN_ACTION_HINT,
    traceId: error.traceId,
    retryable: false,
    source: error.source,
    details,
    ...(rawCause !== undefined ? { cause: rawCause } : {}),
  });
}

type KnownUsageSummary = {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
  readonly reasoningOutputTokens?: number;
};

function toUsageJsonObject(usage: KnownUsageSummary | undefined): JsonObject | undefined {
  if (!usage) return undefined;
  const out: Record<string, number> = {};
  if (typeof usage.promptTokens === 'number') out.promptTokens = usage.promptTokens;
  if (typeof usage.completionTokens === 'number') out.completionTokens = usage.completionTokens;
  if (typeof usage.totalTokens === 'number') out.totalTokens = usage.totalTokens;
  if (typeof usage.cachedInputTokens === 'number') out.cachedInputTokens = usage.cachedInputTokens;
  if (typeof usage.reasoningOutputTokens === 'number') out.reasoningOutputTokens = usage.reasoningOutputTokens;
  return Object.keys(out).length > 0 ? out : undefined;
}

// @nimi-authority: rule.nimi.sdks.client-core.r021
export function createPostTerminalPresentationCanceledError(input: {
  readonly cancelReason?: unknown;
  readonly finishReason: string;
  readonly usage?: KnownUsageSummary;
  readonly traceId?: string;
  readonly route?: ImmediateExecutionRoute;
}): NimiError {
  const cancelReasonText = summarizeCancelReason(input.cancelReason);
  const usageJson = toUsageJsonObject(input.usage);
  const details: JsonObject = {
    canceled: true,
    cancelStage: 'presentation',
    ...(cancelReasonText ? { cancelReason: cancelReasonText } : {}),
    outcomeStatus: 'completed',
    terminalObserved: true,
    finishReason: input.finishReason,
    ...(usageJson ? { usage: usageJson } : {}),
    ...(input.route && input.route !== 'unknown' ? { route: input.route } : {}),
  };
  return createNimiError({
    message: cancelReasonText
      ? `Presentation was canceled after owner execution completed (${input.finishReason}): ${cancelReasonText}.`
      : `Presentation was canceled after owner execution completed (${input.finishReason}).`,
    code: 'OPERATION_ABORTED',
    reasonCode: 'OPERATION_ABORTED',
    actionHint: NIMI_PRESENTATION_CANCELED_AFTER_COMPLETION_ACTION_HINT,
    traceId: input.traceId,
    retryable: false,
    source: 'sdk',
    details,
    ...(input.cancelReason !== undefined ? { cause: input.cancelReason } : {}),
  });
}

// @nimi-authority: rule.nimi.sdks.client-core.r021
export function createPostTerminalCleanupError(
  error: unknown,
  input: {
    readonly terminalOutcome: 'done' | 'error';
    readonly finishReason?: string;
    readonly usage?: KnownUsageSummary;
    readonly traceId?: string;
    readonly route?: ImmediateExecutionRoute;
  },
): NimiError {
  const cleanupSummary = summarizeCancelReason(error) ?? 'Stream cleanup failed';
  const usageJson = toUsageJsonObject(input.usage);
  const details: JsonObject = {
    phase: 'stream-cleanup',
    terminalObserved: true,
    terminalOutcome: input.terminalOutcome,
    ...(input.finishReason ? { finishReason: input.finishReason } : {}),
    ...(usageJson ? { usage: usageJson } : {}),
    ...(input.route && input.route !== 'unknown' ? { route: input.route } : {}),
  };
  const message = input.terminalOutcome === 'done'
    ? `Stream cleanup failed after owner execution completed (${input.finishReason ?? 'done'}): ${cleanupSummary}. Do not replay the completed request.`
    : `Stream cleanup failed after terminal error event: ${cleanupSummary}.`;
  return createNimiError({
    message,
    code: 'SDK_AI_STREAM_CLEANUP_FAILED',
    reasonCode: 'SDK_AI_STREAM_CLEANUP_FAILED',
    actionHint: NIMI_POST_TERMINAL_CLEANUP_ACTION_HINT,
    traceId: input.traceId,
    retryable: false,
    source: 'sdk',
    details,
    cause: error,
  });
}
