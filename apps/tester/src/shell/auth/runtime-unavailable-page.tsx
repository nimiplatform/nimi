import type { OfflineTier } from '@nimiplatform/kit/core/offline-coordinator';
import { Button, InlineAlert, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { useTranslation } from '../i18n/index.js';
import { appTitle, type RuntimePlatformUnavailableProjection } from './runtime-platform.js';

type RuntimeUnavailablePageProps = {
  projection?: RuntimePlatformUnavailableProjection;
  message?: string;
  offlineTier?: OfflineTier;
  onRetry: () => void;
};

export function RuntimeUnavailablePage({ projection, message, offlineTier, onRetry }: RuntimeUnavailablePageProps) {
  const { t } = useTranslation();
  // Simulator fixtures may carry a literal `message` without a `messageKey`.
  const body = message
    || (projection?.messageKey ? t(projection.messageKey) : projection?.message)
    || t('Auth.runtime.projectionNotReady');
  const accountSignInRequired = projection?.reasonCode === 'runtime-unauthenticated';
  const nextAction = userAction(t, projection?.actionHint);
  return (
    <main className="runtime-unavailable-screen" aria-live="polite">
      <Surface className="runtime-unavailable-panel" material="glass-thick" tone="panel" elevation="floating">
        <div className="runtime-unavailable-heading">
          <StatusBadge tone="warning" shape="dot">{t('Auth.runtime.setupRequired')}</StatusBadge>
          <h1>{appTitle}</h1>
        </div>
        <InlineAlert tone="warning">
          <div className="runtime-alert-copy">
            <strong>{accountSignInRequired ? t('Auth.runtime.signInRequired') : t('Auth.runtime.connectionRequired')}</strong>
            <span>{body}</span>
          </div>
        </InlineAlert>
        {offlineTier ? <p className="runtime-action-hint">{t('Auth.runtime.offlineTier', { tier: offlineTier })}</p> : null}
        {nextAction ? <p className="runtime-action-hint">{t('Auth.runtime.next', { action: nextAction })}</p> : null}
        <Button type="button" tone="primary" onClick={onRetry}>{t('Auth.runtime.retryCheck')}</Button>
      </Surface>
    </main>
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
