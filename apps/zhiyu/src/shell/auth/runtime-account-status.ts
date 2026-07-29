import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import type { ZhiyuEvidence } from '../app/evidence';
import { normalizeZhiyuElectronRuntimeUnavailableError } from '../runtime/electron-runtime-unavailable';
import { getZhiyuLocalAppClient } from './runtime-platform';

export type ZhiyuAuthStatus = ZhiyuEvidence['auth'];

export async function probeZhiyuRuntimeAccountStatus(): Promise<ZhiyuAuthStatus> {
  if (typeof window === 'undefined' || !hasElectronRuntime()) {
    return authUnavailable({
      reasonCode: 'electron-runtime-bridge-unavailable',
      actionHint: 'restart_zhiyu_electron_shell',
      source: 'renderer',
      message: 'Electron Runtime bridge is not available.',
    });
  }

  try {
    const session = await getZhiyuLocalAppClient().auth.status();
    return {
      transport: 'electron-ipc',
      ready: session.sessionBound,
      state: session.state,
      reasonCode: session.reasonCode,
      accountReasonCode: 'LOCAL_APP_SESSION',
      actionHint: session.actionHint,
      source: 'runtime',
      message: `Local-app Runtime session state: ${session.state}.`,
      accountId: null,
      displayName: null,
      productionInert: false,
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
    actionHint: unavailable?.actionHint ?? stringOr(record.actionHint, 'check_local_app_session_status'),
    source: unavailable?.source ?? stringOr(record.source, 'sdk'),
    message: error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Local-app Runtime session status is unavailable.',
  });
}

function authUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
}): ZhiyuAuthStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'unavailable',
    reasonCode: input.reasonCode,
    accountReasonCode: 'LOCAL_APP_SESSION',
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    accountId: null,
    displayName: null,
    productionInert: false,
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
