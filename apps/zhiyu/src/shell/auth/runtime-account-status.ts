import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import { Runtime } from '@nimiplatform/sdk/runtime';
import { AccountReasonCode, AccountSessionState, ReasonCode } from '@nimiplatform/sdk/runtime/wire-types';
import type { ZhiyuEvidence } from '../app/evidence';
import { normalizeZhiyuElectronRuntimeUnavailableError } from '../runtime/electron-runtime-unavailable';
import { appId, getRuntimeAccountCaller } from './runtime-platform';

export type ZhiyuAuthStatus = ZhiyuEvidence['auth'];

export async function probeZhiyuRuntimeAccountStatus(): Promise<ZhiyuAuthStatus> {
  if (typeof window === 'undefined' || !hasElectronRuntime()) {
    return authUnavailable({
      reasonCode: 'electron-runtime-bridge-unavailable',
      accountReasonCode: 'UNKNOWN',
      actionHint: 'restart_zhiyu_electron_shell',
      source: 'renderer',
      message: 'Electron Runtime bridge is not available.',
    });
  }

  const runtime = new Runtime({
    appId,
    transport: { type: 'electron-ipc' },
  });

  try {
    const response = await runtime.account.getAccountSessionStatus({
      caller: getRuntimeAccountCaller(),
    });
    const stateLabel = accountSessionStateLabel(response.state);
    return {
      transport: 'electron-ipc',
      ready: response.state === AccountSessionState.AUTHENTICATED,
      state: stateLabel,
      reasonCode: reasonCodeLabel(response.reasonCode),
      accountReasonCode: accountReasonCodeLabel(response.accountReasonCode),
      actionHint: response.state === AccountSessionState.AUTHENTICATED
        ? 'none'
        : 'open_runtime_account_login',
      source: 'runtime',
      message: `Runtime account session state: ${stateLabel}.`,
      accountId: stringOr(response.accountProjection?.accountId, null),
      displayName: stringOr(response.accountProjection?.displayName, null),
      productionInert: response.productionInert === true,
    };
  } catch (error) {
    return normalizeAccountStatusError(error);
  }
}

function normalizeAccountStatusError(error: unknown): ZhiyuAuthStatus {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const unavailable = normalizeZhiyuElectronRuntimeUnavailableError(error);
  return authUnavailable({
    reasonCode: unavailable?.reasonCode ?? stringOr(record.reasonCode, 'runtime-account-status-unavailable'),
    accountReasonCode: 'UNKNOWN',
    actionHint: unavailable?.actionHint ?? stringOr(record.actionHint, 'check_runtime_account_status'),
    source: unavailable?.source ?? stringOr(record.source, 'sdk'),
    message: error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Runtime account status is unavailable.',
  });
}

function authUnavailable(input: {
  readonly reasonCode: string;
  readonly accountReasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
}): ZhiyuAuthStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'UNAVAILABLE',
    reasonCode: input.reasonCode,
    accountReasonCode: input.accountReasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    accountId: null,
    displayName: null,
    productionInert: false,
  };
}

function accountSessionStateLabel(value: unknown): string {
  return typeof value === 'number' ? AccountSessionState[value] ?? String(value) : String(value || 'UNSPECIFIED');
}

function reasonCodeLabel(value: unknown): string {
  return typeof value === 'number' ? ReasonCode[value] ?? String(value) : String(value || 'UNKNOWN');
}

function accountReasonCodeLabel(value: unknown): string {
  return typeof value === 'number' ? AccountReasonCode[value] ?? String(value) : String(value || 'UNKNOWN');
}

function stringOr(value: unknown, fallback: string): string;
function stringOr(value: unknown, fallback: null): string | null;
function stringOr(value: unknown, fallback: string | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
