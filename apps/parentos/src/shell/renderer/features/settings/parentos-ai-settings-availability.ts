import { getRuntimeBridgeStatus } from '../../bridge/runtime-daemon.js';
import type { RuntimeBridgeDaemonStatus } from '../../bridge/types.js';
import { loadParentosRuntimeRouteOptions } from '../../infra/parentos-runtime-route-options.js';
import { describeError, logRendererEvent } from '../../infra/telemetry/renderer-log.js';

export type ParentosAISettingsAvailability =
  | {
    kind: 'ready';
    status: RuntimeBridgeDaemonStatus;
  }
  | {
    kind: 'daemon-unavailable';
    status: RuntimeBridgeDaemonStatus;
    detail: string;
  }
  | {
    kind: 'route-options-failed';
    status: RuntimeBridgeDaemonStatus;
    detail: string;
  };

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || 'unknown error');
}

export async function probeParentosAISettingsAvailability(): Promise<ParentosAISettingsAvailability> {
  const status = await getRuntimeBridgeStatus().catch((error: unknown) => {
    logRendererEvent({
      level: 'warn',
      area: 'settings.ai.runtime-status',
      message: 'action:runtime-bridge-status-failed',
      details: {
        error: describeError(error),
      },
    });
    return {
      running: false,
      managed: false,
      launchMode: 'INVALID' as const,
      grpcAddr: '127.0.0.1:46371',
      lastError: errorMessage(error),
    };
  });

  if (!status.running) {
    return {
      kind: 'daemon-unavailable',
      status,
      detail: status.lastError || 'nimi runtime daemon is not running',
    };
  }

  try {
    await loadParentosRuntimeRouteOptions('text.generate');
    return {
      kind: 'ready',
      status,
    };
  } catch (error) {
    logRendererEvent({
      level: 'error',
      area: 'settings.ai.route-options',
      message: 'action:runtime-route-options-probe-failed',
      details: {
        error: describeError(error),
      },
    });
    return {
      kind: 'route-options-failed',
      status,
      detail: errorMessage(error),
    };
  }
}

export function parentosAISettingsAvailabilityLabel(
  availability: ParentosAISettingsAvailability | null,
): string {
  if (!availability) {
    return '运行时检测中';
  }
  if (availability.kind === 'ready') {
    return '运行时已连接';
  }
  if (availability.kind === 'daemon-unavailable') {
    return '运行时未连接';
  }
  return '路由快照不可用';
}

export function parentosAISettingsAvailabilityHint(
  availability: ParentosAISettingsAvailability | null,
): string {
  if (!availability || availability.kind === 'ready') {
    return '';
  }
  if (availability.kind === 'daemon-unavailable') {
    return '当前未检测到 nimi runtime daemon，请确认 runtime 已启动后再使用模型选择器。你仍可手动填写 route、model 和 connector。';
  }
  return `runtime route snapshot 读取失败：${availability.detail}。你仍可手动填写 route、model 和 connector。`;
}

export function parentosAISettingsAvailabilityBannerCopy(
  availability: ParentosAISettingsAvailability | null,
): {
  kind: 'warning' | 'error';
  message: string;
} | null {
  if (!availability || availability.kind === 'ready') {
    return null;
  }
  if (availability.kind === 'daemon-unavailable') {
    return {
      kind: 'warning',
      message: `运行时未连接，模型选择不可用。请确认 nimi runtime 已启动。${availability.detail ? ` (${availability.detail})` : ''}`,
    };
  }
  return {
    kind: 'error',
    message: `runtime 路由快照读取失败，模型选择器暂不可用。${availability.detail}`,
  };
}
