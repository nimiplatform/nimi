import { useCallback, useMemo, type ReactNode } from 'react';
import { WorkbenchRuntimeGate, type WorkbenchRuntimeGateProjection } from '../../workbench-core/index.js';
import { useTranslation } from '../i18n/index.js';
import {
  appTitle,
  clearRuntimePlatformProjection,
  getRuntimePlatformProjection,
} from './runtime-platform.js';

export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const resolve = useCallback(async (): Promise<WorkbenchRuntimeGateProjection> => {
    const projection = await getRuntimePlatformProjection();
    if (projection.status === 'ready') return { status: 'ready' };
    const body = (projection.messageKey ? t(projection.messageKey) : projection.message)
      || t('Auth.runtime.projectionNotReady');
    return {
      status: 'unavailable',
      body,
      signInRequired: projection.reasonCode === 'runtime-unauthenticated',
      nextAction: userAction(t, projection.actionHint),
    };
  }, [t]);
  const toErrorMessage = useCallback((error: unknown) => (
    error instanceof Error ? error.message : String(error || t('Auth.runtime.checkFailed'))
  ), [t]);
  const copy = useMemo(() => ({
    checking: t('Auth.runtime.check'),
    setupRequired: t('Auth.runtime.setupRequired'),
    signInRequired: t('Auth.runtime.signInRequired'),
    connectionRequired: t('Auth.runtime.connectionRequired'),
    retry: t('Auth.runtime.retryCheck'),
    offlineTier: (tier: string) => t('Auth.runtime.offlineTier', { tier }),
    nextAction: (action: string) => t('Auth.runtime.next', { action }),
  }), [t]);
  return (
    <WorkbenchRuntimeGate
      appTitle={appTitle}
      copy={copy}
      resolve={resolve}
      clear={clearRuntimePlatformProjection}
      toErrorMessage={toErrorMessage}
    >
      {children}
    </WorkbenchRuntimeGate>
  );
}

function userAction(t: (key: string) => string, actionHint: string | undefined): string {
  switch (actionHint) {
    case 'restart_official_nimi_app_dev_command':
      return t('Auth.runtime.actions.restartDevCommand');
    case 'register_local_development_project':
      return t('Auth.runtime.actions.registerProject');
    case 'open_nimi_desktop_and_retry':
    case 'start_fixed_runtime_service':
      return t('Auth.runtime.actions.openDesktopAndRetry');
    case 'restart_through_verified_desktop_supervisor':
      return t('Auth.runtime.actions.restartThroughSupervisor');
    case 'sign_in_to_nimi_desktop':
      return t('Auth.runtime.actions.signInToDesktop');
    case 'reopen_local_app_session':
      return t('Auth.runtime.actions.reopenSession');
    case 'wait_for_app_access_admission':
      return t('Auth.runtime.actions.waitForAdmission');
    default:
      return '';
  }
}
