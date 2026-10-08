import type { PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { RuntimeLoadingScreen } from './runtime-loading-screen.js';
import { DesktopRecoveryActions, SharedStatusShell } from './status-shell.js';
import { DesktopFormalSessionRecoveryContext, useDesktopFormalSessionReadiness } from './desktop-formal-session.js';

export function DesktopFormalSessionGate(props: PropsWithChildren) {
  const { t } = useTranslation();
  const readiness = useDesktopFormalSessionReadiness();
  return (
    <DesktopFormalSessionRecoveryContext.Provider value={readiness.retry}>
      {readiness.status === 'checking' ? <RuntimeLoadingScreen />
        : readiness.status === 'failed' ? (
          <SharedStatusShell title={t('Bootstrap.localSessionUnavailableTitle')} description={t('Bootstrap.localSessionUnavailableDescription')}>
            <DesktopRecoveryActions
              testId="desktop-formal-session-unavailable"
              retryLabel={t('Bootstrap.localSessionRetry')}
              onRetry={readiness.retry}
              technicalDetail={readiness.reasonCode}
            />
          </SharedStatusShell>
        ) : props.children}
    </DesktopFormalSessionRecoveryContext.Provider>
  );
}
