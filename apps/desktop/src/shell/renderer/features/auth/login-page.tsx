import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { NimiToaster } from '@nimiplatform/kit/ui';
import { useAppStore } from '../../app-shell/providers/app-store';

import { DesktopBrowserAuthGateSurface } from './desktop-browser-auth-gate.js';

export function LoginPage() {
  const location = useLocation();
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);

  if (authStatus === 'authenticated') {
    // Wave 1 route-admission single-point: LoginPage no longer self-redirects
    // when authStatus flips. AppRoutes owns the post-login `/login -> /`
    // handoff via a single useEffect, so a transient renderer/product-control
    // divergence can't drive `<Navigate>` in this component and trip the
    // history.replaceState throttle.
    return null;
  }

  const accountNotice = authStatus === 'expired' || authStatus === 'reauth-required'
    ? t('Auth.reauthenticationRequired', {
        defaultValue: 'Your Runtime account session can no longer be refreshed. Sign in again to continue.',
      })
    : authStatus === 'login-pending'
      ? t('Auth.loginPending', {
          defaultValue: 'Complete sign-in in your browser. This window will continue automatically.',
        })
      : null;

  return (
    <div className="relative min-h-screen">
      <DesktopBrowserAuthGateSurface
        notice={accountNotice}
        autoStart={Boolean((location.state as { accountSwitch?: boolean } | null)?.accountSwitch)}
      />
      <NimiToaster dismissLabel={t('Common.close', { defaultValue: 'Close' })} />
    </div>
  );
}
