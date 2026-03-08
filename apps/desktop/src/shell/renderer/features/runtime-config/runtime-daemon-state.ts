import type { RuntimeBridgeDaemonStatus } from '@renderer/bridge';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';

export type RuntimeDaemonStatusApplyMode = 'poll' | 'action';

type RuntimeDaemonStatusDetail = {
  runningDetail: string;
  stoppedDetail: string;
};

function formatLaunchModeSuffix(status: RuntimeBridgeDaemonStatus): string {
  const launchMode = String((status as { launchMode?: unknown }).launchMode || '')
    .trim()
    .toUpperCase();
  if (!launchMode) {
    return '';
  }
  if (launchMode === 'RUNTIME' || launchMode === 'RELEASE' || launchMode === 'INVALID') {
    return ` · mode=${launchMode}`;
  }
  return '';
}

function buildRuntimeDaemonStatusDetail(status: RuntimeBridgeDaemonStatus): RuntimeDaemonStatusDetail {
  const modeSuffix = formatLaunchModeSuffix(status);
  const runningDetail = `runtime daemon running (${status.grpcAddr})${modeSuffix}`;
  const stoppedDetail = `runtime daemon stopped (${status.grpcAddr})${modeSuffix}${status.lastError ? `: ${status.lastError}` : ''}`;
  return {
    runningDetail,
    stoppedDetail,
  };
}

export function applyRuntimeDaemonStatusToConfigState(
  previous: RuntimeConfigStateV11,
  status: RuntimeBridgeDaemonStatus,
  mode: RuntimeDaemonStatusApplyMode,
  checkedAt: string,
): RuntimeConfigStateV11 {
  const detail = buildRuntimeDaemonStatusDetail(status);

  if (!status.running) {
    if (
      previous.local.status === 'unreachable'
      && previous.local.lastDetail === detail.stoppedDetail
    ) {
      return previous;
    }
    return {
      ...previous,
      local: {
        ...previous.local,
        status: 'unreachable',
        lastCheckedAt: checkedAt,
        lastDetail: detail.stoppedDetail,
      },
    };
  }

  if (mode === 'action' || previous.local.status === 'unreachable') {
    return {
      ...previous,
      local: {
        ...previous.local,
        status: 'idle',
        lastCheckedAt: checkedAt,
        lastDetail: detail.runningDetail,
      },
    };
  }

  return previous;
}
