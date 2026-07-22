import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererBindings } from '../../renderer/binding-context';

import { WebAuthMenu } from './web-auth-menu.js';

export function LoginPage() {
  const bindings = useDesktopRendererBindings();
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const clearAuthSession = useAppStore((state) => state.clearAuthSession);

  useEffect(() => {
    let active = true;
    void bindings.app.commands.reconcileLoginState({ authStatus }).then((result) => {
      if (active && result.clearAuthSession) clearAuthSession();
    });
    return () => { active = false; };
  }, [authStatus, bindings, clearAuthSession]);

  if (authStatus === 'authenticated') {
    // Wave 1 route-admission single-point: LoginPage no longer self-redirects
    // when authStatus flips. AppRoutes owns the post-login `/login -> /`
    // handoff via a single useEffect, so a transient renderer/product-control
    // divergence can't drive `<Navigate>` in this component and trip the
    // history.replaceState throttle.
    return null;
  }

  const authMode = bindings.app.projection.loginMode();
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
      {accountNotice ? (
        <div
          role="status"
          data-testid="desktop-account-state-notice"
          className="absolute inset-x-4 top-10 z-30 mx-auto max-w-xl rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-3 text-center text-sm leading-6 text-[var(--nimi-text-secondary)] shadow-[var(--nimi-elevation-raised)]"
        >
          {accountNotice}
        </div>
      ) : null}
      <WebAuthMenu mode={authMode} />
    </div>
  );
}
