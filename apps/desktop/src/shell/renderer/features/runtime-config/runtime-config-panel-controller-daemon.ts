import { useCallback, useState } from 'react';
import { desktopBridge, type RuntimeBridgeDaemonStatus } from '@renderer/bridge';
import { applyRuntimeDaemonStatusToConfigState } from './runtime-daemon-state';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/types';
import type { SetRuntimeConfigBanner } from './runtime-config-panel-controller-utils';

export type RuntimeDaemonAction = 'start' | 'restart' | 'stop';

export type UseRuntimeConfigDaemonControllerInput = {
  updateState: (updater: (previous: RuntimeConfigStateV11) => RuntimeConfigStateV11) => void;
  runLocalRuntimeHealthCheck: () => Promise<void>;
  setStatusBanner: SetRuntimeConfigBanner;
};

export type UseRuntimeConfigDaemonControllerOutput = {
  runtimeDaemonStatus: RuntimeBridgeDaemonStatus | null;
  runtimeDaemonBusyAction: RuntimeDaemonAction | null;
  runtimeDaemonError: string;
  runtimeDaemonUpdatedAt: string | null;
  refreshRuntimeDaemonStatus: () => Promise<void>;
  startRuntimeDaemon: () => Promise<void>;
  restartRuntimeDaemon: () => Promise<void>;
  stopRuntimeDaemon: () => Promise<void>;
};

export function useRuntimeConfigDaemonController(
  input: UseRuntimeConfigDaemonControllerInput,
): UseRuntimeConfigDaemonControllerOutput {
  const { updateState, runLocalRuntimeHealthCheck, setStatusBanner } = input;

  const [runtimeDaemonStatus, setRuntimeDaemonStatus] = useState<RuntimeBridgeDaemonStatus | null>(null);
  const [runtimeDaemonBusyAction, setRuntimeDaemonBusyAction] = useState<RuntimeDaemonAction | null>(null);
  const [runtimeDaemonError, setRuntimeDaemonError] = useState('');
  const [runtimeDaemonUpdatedAt, setRuntimeDaemonUpdatedAt] = useState<string | null>(null);

  const applyRuntimeDaemonStatusToState = useCallback((
    status: RuntimeBridgeDaemonStatus,
    mode: 'poll' | 'action',
  ) => {
    const checkedAt = new Date().toISOString();
    updateState((previous) => {
      return applyRuntimeDaemonStatusToConfigState(previous, status, mode, checkedAt);
    });
  }, [updateState]);

  const refreshRuntimeDaemonStatus = useCallback(async () => {
    try {
      const status = await desktopBridge.getRuntimeBridgeStatus();
      setRuntimeDaemonStatus(status);
      setRuntimeDaemonUpdatedAt(new Date().toISOString());
      setRuntimeDaemonError('');
      applyRuntimeDaemonStatusToState(status, 'poll');
    } catch (error) {
      setRuntimeDaemonError(error instanceof Error ? error.message : String(error || 'runtime daemon status failed'));
    }
  }, [applyRuntimeDaemonStatusToState]);

  const runRuntimeDaemonAction = useCallback(async (action: RuntimeDaemonAction) => {
    setRuntimeDaemonBusyAction(action);
    setRuntimeDaemonError('');
    try {
      const status = action === 'start'
        ? await desktopBridge.startRuntimeBridge()
        : action === 'restart'
          ? await desktopBridge.restartRuntimeBridge()
          : await desktopBridge.stopRuntimeBridge();
      setRuntimeDaemonStatus(status);
      setRuntimeDaemonUpdatedAt(new Date().toISOString());
      applyRuntimeDaemonStatusToState(status, 'action');
      await runLocalRuntimeHealthCheck();
      setStatusBanner({
        kind: status.running ? 'success' : 'warning',
        message: `Runtime daemon ${action} ${status.running ? 'completed' : 'stopped'}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || `runtime daemon ${action} failed`);
      setRuntimeDaemonError(message);
      setStatusBanner({
        kind: 'error',
        message: `Runtime daemon ${action} failed: ${message}`,
      });
      throw error;
    } finally {
      setRuntimeDaemonBusyAction(null);
    }
  }, [applyRuntimeDaemonStatusToState, runLocalRuntimeHealthCheck, setStatusBanner]);

  const startRuntimeDaemon = useCallback(async () => {
    await runRuntimeDaemonAction('start');
  }, [runRuntimeDaemonAction]);

  const restartRuntimeDaemon = useCallback(async () => {
    await runRuntimeDaemonAction('restart');
  }, [runRuntimeDaemonAction]);

  const stopRuntimeDaemon = useCallback(async () => {
    await runRuntimeDaemonAction('stop');
  }, [runRuntimeDaemonAction]);

  return {
    runtimeDaemonStatus,
    runtimeDaemonBusyAction,
    runtimeDaemonError,
    runtimeDaemonUpdatedAt,
    refreshRuntimeDaemonStatus,
    startRuntimeDaemon,
    restartRuntimeDaemon,
    stopRuntimeDaemon,
  };
}
