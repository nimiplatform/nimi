import { useCallback, useMemo, type ReactNode } from 'react';
import { hasElectronInvoke, openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';
import { notifyStudioAIConfigChanged } from '../../ai-studio-core/ai-config.js';
import {
  WorkbenchRuntimeGate,
  type WorkbenchRuntimeGateProjection,
  type WorkbenchRuntimeGateRecoveryAction,
} from '../../workbench-core/index.js';
import { useTranslation } from '../i18n/index.js';
import {
  appTitle,
  clearRuntimePlatformProjection,
  getRuntimePlatformProjection,
} from './runtime-platform.js';
import { subscribeLabLocalAppSessionLoss } from './session-loss.js';
import { useLabNavigationOwner } from '../routes/app-navigation.js';

// A fresh session rereads AIConfig views that failed on the stale one.
function refreshAIConfigViews(): void {
  notifyStudioAIConfigChanged(window);
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { setReady } = useLabNavigationOwner();
  const brandMark = useMemo(() => {
    const iconUrl = new URL('../../../assets/app-icon-256.png', import.meta.url).href;
    return <img src={iconUrl} alt="" />;
  }, []);
  const revalidate = useCallback((onLoss: () => void) => subscribeLabLocalAppSessionLoss(() => { setReady(false); onLoss(); }), [setReady]);
  const resolve = useCallback(async (): Promise<WorkbenchRuntimeGateProjection> => {
    const projection = await getRuntimePlatformProjection();
    if (projection.status === 'ready') { setReady(true); return { status: 'ready' }; }
    setReady(false);
    const body = (projection.messageKey ? t(projection.messageKey) : projection.message)
      || t('Auth.runtime.projectionNotReady');
    const signInRequired = projection.reasonCode === 'runtime-unauthenticated';
    const actionHint = signInRequired ? 'sign_in_to_nimi_desktop' : projection.actionHint;
    return {
      status: 'unavailable',
      title: headlineForReason(t, projection.reasonCode),
      body,
      signInRequired,
      nextAction: userAction(t, actionHint),
      recoveryAction: recoveryActionForProjection(t, actionHint),
      technicalDetails: [
        { label: t('Auth.runtime.details.reason'), value: projection.reasonCode },
        ...(projection.actionHint ? [{ label: t('Auth.runtime.details.actionHint'), value: projection.actionHint }] : []),
      ],
    };
  }, [t, setReady]);
  const toErrorMessage = useCallback((error: unknown) => (
    error instanceof Error ? error.message : String(error || t('Auth.runtime.checkFailed'))
  ), [t]);
  const copy = useMemo(() => ({
    checking: t('Auth.runtime.check'),
    checkingHint: t('Auth.runtime.checkingHint'),
    setupRequired: t('Auth.runtime.setupRequired'),
    signInRequired: t('Auth.runtime.signInRequired'),
    connectionRequired: t('Auth.runtime.connectionRequired'),
    retry: t('Auth.runtime.retryCheck'),
    offlineTier: (tier: string) => t('Auth.runtime.offlineTier', { tier }),
    nextAction: (action: string) => t('Auth.runtime.next', { action }),
    stepLabel: t('Auth.runtime.stepLabel'),
    recheckStillUnavailable: t('Auth.runtime.recheckStillUnavailable'),
    protectionLabel: t('Auth.runtime.details.protection'),
    technicalDetails: t('Auth.runtime.details.title'),
  }), [t]);
  return (
    <WorkbenchRuntimeGate
      appTitle={appTitle}
      brandMark={brandMark}
      copy={copy}
      resolve={resolve}
      clear={clearRuntimePlatformProjection}
      toErrorMessage={toErrorMessage}
      revalidate={revalidate}
      onRevalidated={refreshAIConfigViews}
    >
      {children}
    </WorkbenchRuntimeGate>
  );
}

function headlineForReason(t: (key: string) => string, reasonCode: string): string {
  switch (reasonCode) {
    case 'runtime-unauthenticated':
      return t('Auth.runtime.signInRequired');
    case 'revoked':
    case 'account-changed':
    case 'runtime-restarted':
      return t('Auth.runtime.headlines.sessionEnded');
    case 'project-changed':
    case 'local-development-registration-not-found':
    case 'local-development-project-changed':
      return t('Auth.runtime.headlines.registrationRequired');
    case 'runtime-service-untrusted':
    case 'process-replaced':
      return t('Auth.runtime.headlines.supervisorRequired');
    case 'local-app-operation-unavailable':
      return t('Auth.runtime.headlines.admissionPending');
    default:
      return t('Auth.runtime.connectionRequired');
  }
}

function recoveryActionForProjection(
  t: (key: string) => string,
  actionHint: string | undefined,
): WorkbenchRuntimeGateRecoveryAction | undefined {
  if (actionHint === 'wait_for_app_access_admission') {
    if (!hasElectronInvoke()) return undefined;
    return {
      label: t('Auth.runtime.recovery.openApps'),
      run: async () => {
        try {
          const result = await openDesktopIntent({ intent: { kind: 'open-apps' } });
          return result.status === 'accepted' ? t('Auth.runtime.recovery.openedHome') : t('Auth.runtime.recovery.homeUnavailable');
        } catch {
          return t('Auth.runtime.recovery.homeUnavailable');
        }
      },
    };
  }
  return undefined;
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
