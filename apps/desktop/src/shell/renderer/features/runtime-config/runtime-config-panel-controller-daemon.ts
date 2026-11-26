import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeBridgeDaemonStatus } from '../../bridge';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { applyRuntimeDaemonStatusToConfigState } from './runtime-daemon-state';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import type { SetRuntimeConfigBanner } from './runtime-config-panel-controller-utils';

export type RuntimeDaemonAction = 'refresh' | 'start' | 'restart';

export type UseRuntimeConfigDaemonControllerInput = {
  updateState: (updater: (previous: RuntimeConfigStateV11) => RuntimeConfigStateV11) => void;
  runLocalHealthCheck: () => Promise<void>;
  setStatusBanner: SetRuntimeConfigBanner;
};

export type UseRuntimeConfigDaemonControllerOutput = {
  runtimeDaemonStatus: RuntimeBridgeDaemonStatus | null;
  runtimeDaemonBusyAction: RuntimeDaemonAction | null;
  runtimeDaemonError: string;
  runtimeDaemonUpdatedAt: string | null;
  refreshRuntimeDaemonStatus: (options?: { silent?: boolean }) => Promise<void>;
  startRuntimeDaemon: () => Promise<void>;
  restartRuntimeDaemon: () => Promise<void>;
};

export function useRuntimeConfigDaemonController(
  input: UseRuntimeConfigDaemonControllerInput,
): UseRuntimeConfigDaemonControllerOutput {
  const { updateState, runLocalHealthCheck, setStatusBanner } = input;
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();

  const [runtimeDaemonStatus, setRuntimeDaemonStatus] = useState<RuntimeBridgeDaemonStatus | null>(null);
  const [runtimeDaemonBusyAction, setRuntimeDaemonBusyAction] = useState<RuntimeDaemonAction | null>(null);
  const [runtimeDaemonError, setRuntimeDaemonError] = useState('');
  const [runtimeDaemonUpdatedAt, setRuntimeDaemonUpdatedAt] = useState<string | null>(null);

  const applyRuntimeDaemonStatusToState = useCallback((
    status: RuntimeBridgeDaemonStatus,
    mode: 'poll' | 'action',
  ) => {
    const checkedAt = new Date(bindings.clock.now()).toISOString();
    updateState((previous) => {
      return applyRuntimeDaemonStatusToConfigState(previous, status, mode, checkedAt);
    });
  }, [bindings.clock, updateState]);

  const refreshRuntimeDaemonStatus = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setRuntimeDaemonBusyAction('refresh');
    }
    try {
      const status = await bindings.app.commands.runtimeDaemon.status();
      setRuntimeDaemonStatus(status);
      setRuntimeDaemonUpdatedAt(new Date(bindings.clock.now()).toISOString());
      setRuntimeDaemonError('');
      applyRuntimeDaemonStatusToState(status, 'poll');
    } catch (error) {
      setRuntimeDaemonError(error instanceof Error ? error.message : String(error || 'runtime daemon status failed'));
    } finally {
      if (!silent) {
        setRuntimeDaemonBusyAction((current) => (current === 'refresh' ? null : current));
      }
    }
  }, [applyRuntimeDaemonStatusToState, bindings.app.commands.runtimeDaemon, bindings.clock]);

  const runRuntimeDaemonAction = useCallback(async (action: Exclude<RuntimeDaemonAction, 'refresh'>) => {
    setRuntimeDaemonBusyAction(action);
    setRuntimeDaemonError('');
    try {
      const status = action === 'start'
        ? await bindings.app.commands.runtimeDaemon.start()
        : await bindings.app.commands.runtimeDaemon.restart();
      setRuntimeDaemonStatus(status);
      setRuntimeDaemonUpdatedAt(new Date(bindings.clock.now()).toISOString());
      applyRuntimeDaemonStatusToState(status, 'action');
      await runLocalHealthCheck();
      const actionLabel = action === 'start'
        ? t('runtimeConfig.overview.daemonActionStart', { defaultValue: 'start' })
        : t('runtimeConfig.overview.daemonActionRestart', { defaultValue: 'restart' });
      setStatusBanner({
        kind: status.running ? 'success' : 'warning',
        message: status.running
          ? t('runtimeConfig.overview.daemonActionCompleted', {
            action: actionLabel,
            defaultValue: 'Runtime daemon {{action}} completed',
          })
          : t('runtimeConfig.overview.daemonActionStopped', {
            action: actionLabel,
            defaultValue: 'Runtime daemon {{action}} stopped',
          }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || `runtime daemon ${action} failed`);
      const actionLabel = action === 'start'
        ? t('runtimeConfig.overview.daemonActionStart', { defaultValue: 'start' })
        : t('runtimeConfig.overview.daemonActionRestart', { defaultValue: 'restart' });
      setRuntimeDaemonError(message);
      setStatusBanner({
        kind: 'error',
        message: t('runtimeConfig.overview.daemonActionFailed', {
          action: actionLabel,
          message,
          defaultValue: 'Runtime daemon {{action}} failed: {{message}}',
        }),
      });
    } finally {
      setRuntimeDaemonBusyAction(null);
    }
  }, [applyRuntimeDaemonStatusToState, bindings.app.commands.runtimeDaemon, bindings.clock, runLocalHealthCheck, setStatusBanner, t]);

  const startRuntimeDaemon = useCallback(async () => {
    await runRuntimeDaemonAction('start');
  }, [runRuntimeDaemonAction]);

  const restartRuntimeDaemon = useCallback(async () => {
    await runRuntimeDaemonAction('restart');
  }, [runRuntimeDaemonAction]);

  return {
    runtimeDaemonStatus,
    runtimeDaemonBusyAction,
    runtimeDaemonError,
    runtimeDaemonUpdatedAt,
    refreshRuntimeDaemonStatus,
    startRuntimeDaemon,
    restartRuntimeDaemon,
  };
}
