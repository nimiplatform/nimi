import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import type { ZhiyuEvidence } from '../app/evidence';
import { getZhiyuLocalAppClient } from '../auth/runtime-platform';
import { normalizeZhiyuElectronRuntimeUnavailableError } from './electron-runtime-unavailable';

export type ZhiyuRuntimeStatus = ZhiyuEvidence['runtime'];

export async function probeZhiyuRuntimeStatus(): Promise<ZhiyuRuntimeStatus> {
  if (typeof window === 'undefined' || !hasElectronRuntime()) {
    return {
      transport: 'electron-ipc',
      ready: false,
      reasonCode: 'electron-runtime-bridge-unavailable',
      actionHint: 'restart_zhiyu_electron_shell',
      source: 'renderer',
      message: 'Electron Runtime bridge is unavailable.',
    };
  }

  try {
    const session = await getZhiyuLocalAppClient().auth.status();
    return {
      transport: 'electron-ipc',
      ready: session.sessionBound,
      reasonCode: session.reasonCode,
      actionHint: session.actionHint,
      source: 'runtime',
      message: session.sessionBound
        ? 'Zhiyu local-app session is bound.'
        : 'Zhiyu local-app session requires attention.',
    };
  } catch (error) {
    return serializeRuntimeStatusError(error);
  }
}

function serializeRuntimeStatusError(error: unknown): ZhiyuRuntimeStatus {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const unavailable = normalizeZhiyuElectronRuntimeUnavailableError(error);
  return {
    transport: 'electron-ipc',
    ready: false,
    reasonCode: unavailable?.reasonCode ?? stringOr(record.reasonCode, 'runtime-unavailable'),
    actionHint: unavailable?.actionHint ?? stringOr(record.actionHint, 'check_runtime_endpoint'),
    source: unavailable?.source ?? stringOr(record.source, 'sdk'),
    message: error instanceof Error ? error.message : String(error || 'Runtime unavailable.'),
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
