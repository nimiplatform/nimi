import type { RuntimeBridgeDaemonStatus } from '@renderer/bridge';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/v11/types';

export type RuntimeDaemonStatusApplyMode = 'poll' | 'action';

type RuntimeDaemonStatusDetail = {
  runningDetail: string;
  stoppedDetail: string;
};

function buildRuntimeDaemonStatusDetail(status: RuntimeBridgeDaemonStatus): RuntimeDaemonStatusDetail {
  const runningDetail = `runtime daemon running (${status.grpcAddr}) · mode=${status.launchMode}`;
  const stoppedDetail = `runtime daemon stopped (${status.grpcAddr}) · mode=${status.launchMode}${status.lastError ? `: ${status.lastError}` : ''}`;
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
      previous.localRuntime.status === 'unreachable'
      && previous.localRuntime.lastDetail === detail.stoppedDetail
    ) {
      return previous;
    }
    return {
      ...previous,
      localRuntime: {
        ...previous.localRuntime,
        status: 'unreachable',
        lastCheckedAt: checkedAt,
        lastDetail: detail.stoppedDetail,
      },
    };
  }

  if (mode === 'action' || previous.localRuntime.status === 'unreachable') {
    return {
      ...previous,
      localRuntime: {
        ...previous.localRuntime,
        status: 'idle',
        lastCheckedAt: checkedAt,
        lastDetail: detail.runningDetail,
      },
    };
  }

  return previous;
}
