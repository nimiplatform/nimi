import { getDaemonStatus, startDaemon } from '../bridge/index.js';
import { AccountReasonCode, ReasonCode } from '@nimiplatform/sdk/runtime/wire-types';
import { useAvatarStore } from './app-store.js';
import { readNormalizedString } from './app-bootstrap-helpers.js';

export type FirstPartyBootstrapStage =
  | 'runtime_daemon_prepare'
  | 'runtime_client_ready'
  | 'formal_app_session_status'
  | 'runtime_app_registration'
  | 'account_session_status'
  | 'realm_connectivity'
  | 'account_access_token'
  | 'conversation_context'
  | 'canonical_conversation_handle'
  | 'runtime_identity_binding'
  | 'runtime_presentation_profile'
  | 'local_avatar_asset_manifest'
  | 'driver_create'
  | 'runtime_carrier_start'
  | 'driver_start';

type FirstPartyBootstrapErrorDetail = {
  reason: string;
  stage: string | null;
  reasonCode: string | null;
  accountReasonCode: string | null;
  actionHint: string | null;
  source: string | null;
  retryable: boolean | null;
  message: string | null;
};

type FirstPartyStageFallbackDiagnostic = {
  reasonCode: string;
  actionHint: string;
  source: string;
  retryable: boolean;
};

function readErrorField(error: unknown, field: string): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value.trim() : '';
}

function readErrorEnumField(
  error: unknown,
  field: string,
  enumObject: Record<string, string | number>,
): string {
  const text = readErrorField(error, field);
  if (text) {
    return text;
  }
  if (!error || typeof error !== 'object') {
    return '';
  }
  const value = (error as Record<string, unknown>)[field];
  return readEnumName(enumObject, value) || '';
}

function readErrorBooleanField(error: unknown, field: string): boolean | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'boolean' ? value : null;
}

function truncateErrorText(value: string, limit = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function describeRuntimeDaemonStatus(status: {
  running?: boolean;
  managed?: boolean;
  launchMode?: string;
  grpcAddr?: string;
  lastError?: string;
} | null | undefined): string {
  if (!status) {
    return 'missing status';
  }
  const parts = [
    `running=${status.running === true ? 'true' : 'false'}`,
    `managed=${status.managed === true ? 'true' : 'false'}`,
    `mode=${readNormalizedString(status.launchMode) || 'unknown'}`,
  ];
  const grpcAddr = readNormalizedString(status.grpcAddr);
  if (grpcAddr) {
    parts.push(`grpc=${grpcAddr}`);
  }
  const lastError = readNormalizedString(status.lastError);
  if (lastError) {
    parts.push(`error=${lastError}`);
  }
  return parts.join(' ');
}

function runtimeDaemonUnavailableError(status: {
  running?: boolean;
  managed?: boolean;
  launchMode?: string;
  grpcAddr?: string;
  lastError?: string;
} | null | undefined): Error {
  return Object.assign(
    new Error(`runtime daemon unavailable after start: ${describeRuntimeDaemonStatus(status)}`),
    {
      reasonCode: readNormalizedString(status?.lastError) || 'RUNTIME_BRIDGE_DAEMON_UNAVAILABLE',
      actionHint: 'start_runtime_daemon',
      source: 'runtime',
      retryable: true,
    },
  );
}

function fallbackDiagnosticForFirstPartyStage(
  stage: string | null,
): FirstPartyStageFallbackDiagnostic | null {
  switch (stage) {
    case 'runtime_presentation_profile':
      return {
        reasonCode: 'RUNTIME_PRESENTATION_PROFILE_UNAVAILABLE',
        actionHint: 'configure_runtime_agent_presentation_profile',
        source: 'runtime',
        retryable: false,
      };
    case 'local_avatar_asset_manifest':
      return {
        reasonCode: 'LOCAL_AVATAR_ASSET_RESOLVE_FAILED',
        actionHint: 'reimport_or_select_local_avatar_asset',
        source: 'avatar_local_materialization',
        retryable: false,
      };
    default:
      return null;
  }
}

export function readEnumName(enumObject: Record<string, string | number>, value: unknown): string | null {
  return typeof value === 'number'
    ? readNormalizedString(enumObject[value])
    : null;
}

export function diagnosticEnumString(value: unknown): string | null {
  if (typeof value === 'string') {
    return readNormalizedString(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

export async function ensureRuntimeDaemonReady(): Promise<void> {
  const current = await getDaemonStatus();
  if (current.running) {
    return;
  }
  const started = await startDaemon();
  if (!started.running) {
    throw runtimeDaemonUnavailableError(started);
  }
}

function annotateFirstPartyBootstrapError(stage: FirstPartyBootstrapStage, error: unknown): never {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.avatarBootstrapStage !== 'string' || !record.avatarBootstrapStage.trim()) {
      record.avatarBootstrapStage = stage;
    }
    throw error;
  }
  const wrapped = new Error(String(error || 'avatar_first_party_runtime_unavailable')) as Error & {
    avatarBootstrapStage?: string;
  };
  wrapped.avatarBootstrapStage = stage;
  throw wrapped;
}

export async function runFirstPartyStage<T>(
  stage: FirstPartyBootstrapStage,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    annotateFirstPartyBootstrapError(stage, error);
  }
}

export async function runFirstPartyStageWithTimeout<T>(
  stage: FirstPartyBootstrapStage,
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  let timeoutId: number | null = null;
  try {
    return await runFirstPartyStage(stage, () => Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(`${stage} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]));
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

export function firstPartyUnavailableDetail(error: unknown): FirstPartyBootstrapErrorDetail {
  const stage = readErrorField(error, 'avatarBootstrapStage') || null;
  const fallback = fallbackDiagnosticForFirstPartyStage(stage);
  const accountReasonCode = readErrorEnumField(error, 'accountReasonCode', AccountReasonCode) || null;
  const reasonCode = readErrorEnumField(error, 'reasonCode', ReasonCode) || fallback?.reasonCode || null;
  const actionHint = readErrorField(error, 'actionHint') || fallback?.actionHint || null;
  const source = readErrorField(error, 'source') || fallback?.source || null;
  const message = error instanceof Error
    ? truncateErrorText(error.message)
    : truncateErrorText(String(error || 'avatar_first_party_runtime_unavailable'));
  const primary = accountReasonCode || reasonCode || message || 'avatar_first_party_runtime_unavailable';
  const suffix = actionHint ? ` / ${actionHint}` : '';
  return {
    reason: stage ? `${stage}: ${primary}${suffix}` : `${primary}${suffix}`,
    stage,
    reasonCode,
    accountReasonCode,
    actionHint,
    source,
    retryable: readErrorBooleanField(error, 'retryable') ?? fallback?.retryable ?? null,
    message: message || null,
  };
}

export function setRuntimeBindingUnavailable(detail: FirstPartyBootstrapErrorDetail): void {
  useAvatarStore.getState().setRuntimeBindingStatus({
    status: 'unavailable',
    reason: detail.reason,
    reasonCode: detail.reasonCode,
    accountReasonCode: detail.accountReasonCode,
    actionHint: detail.actionHint,
    stage: detail.stage,
    source: detail.source,
    retryable: detail.retryable,
  });
}

export function recordDriverStartFailure(error: unknown): void {
  const unavailable = firstPartyUnavailableDetail(error);
  setRuntimeBindingUnavailable(unavailable);
  useAvatarStore.getState().setDriverStatus('error');
}
