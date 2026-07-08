import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import { Runtime } from '@nimiplatform/sdk/runtime';
import { RuntimeHealthStatus } from '@nimiplatform/sdk/runtime/wire-types';
import type { ZhiyuEvidence } from '../app/evidence';
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

  const runtime = new Runtime({
    appId: 'nimi.zhiyu',
    transport: { type: 'electron-ipc' },
  });

  try {
    const health = await runtime.ready();
    const statusLabel = runtimeHealthStatusLabel(health.status);
    return {
      transport: 'electron-ipc',
      ready: health.status === RuntimeHealthStatus.READY,
      reasonCode: String(health.reason || statusLabel || 'runtime-ready'),
      actionHint: 'none',
      source: 'runtime',
      message: `Runtime status: ${statusLabel}.`,
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

function runtimeHealthStatusLabel(status: unknown): string {
  return typeof status === 'number'
    ? RuntimeHealthStatus[status] ?? String(status)
    : String(status || RuntimeHealthStatus.UNSPECIFIED);
}
