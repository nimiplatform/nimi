import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { accountReturnTo } from './account-center-model.js';
import { useTranslation } from 'react-i18next';
import {
  buttonBase,
  buttonDefault,
  buttonOutline,
  WebAccountAuthPage,
} from '@nimiplatform/kit/auth';
import {
  clearWebBrowserSessionForFreshAccountSelection,
  createWebAccountAuthAdapter,
} from './web-account-adapter.js';
import {
  continueOauthNext,
  isFreshAccountSelection,
  isFreshOauthContinuation,
  readValidatedOauthNext,
} from './oauth-continuation.js';
import { webHomeAuthPalette } from './web-auth-appearance.js';

// Keep the landing homepage neutral surfaces; focus and action accents come
// from the shared Nimi auth theme.
function WebAccountStatusShell({ children }: { children: ReactNode }) {
  return (
    <main
      className="nimi-shell-auth-root nimi-shell-auth-brand-surface web-account-session-page"
      data-shell-auth-theme="custom"
      style={webHomeAuthPalette}
    >
      <div className="nimi-shell-auth-shell">
        <div className="nimi-shell-auth-content">{children}</div>
      </div>
    </main>
  );
}

export function WebAccountPage() {
  const { t } = useTranslation();
  useEffect(() => { document.title = `${t('Auth.signIn')} · Nimi`; }, [t]);
  const adapter = useMemo(() => createWebAccountAuthAdapter(), []);
  const [currentUser, setCurrentUser] = useState<Record<string, unknown> | null>(null);
  const [checking, setChecking] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const user = await adapter.loadCurrentUser();
      if (!active) return;
      const oauthNext = readValidatedOauthNext(window.location.search);
      const freshOauthContinuation = isFreshOauthContinuation(window.location.search);
      const freshAccountSelection = isFreshAccountSelection(window.location.search);
      if (user && oauthNext && !freshOauthContinuation) {
        await adapter.completeBrowserSessionLogin();
        return;
      }
      if (user && freshAccountSelection) {
        await clearWebBrowserSessionForFreshAccountSelection();
        if (!active) return;
        if (!continueOauthNext(window.location.search)) {
          throw new Error(t('Account.switchContinuationExpired'));
        }
        return;
      }
      setCurrentUser(freshOauthContinuation ? null : user);
      setChecking(false);
    })().catch((error) => {
      if (!active) return;
      if (extractNimiErrorFields(error).reasonCode === 'ACCOUNT_DELETED') setCurrentUser(null);
      else setSessionError(error instanceof Error ? error.message : t('Account.sessionUnknown'));
      setChecking(false);
    });
    return () => { active = false; };
  }, [adapter, t]);

  if (checking) {
    return (
      <WebAccountStatusShell>
        <p className="web-account-session-message" role="status">{t('Account.sessionCheck')}</p>
      </WebAccountStatusShell>
    );
  }

  if (sessionError) {
    return (
      <WebAccountStatusShell>
        <p className="web-account-session-message" role="alert">{sessionError}</p>
      </WebAccountStatusShell>
    );
  }

  if (currentUser) {
    const params = new URLSearchParams(window.location.search);
    if (params.has('returnTo') && !params.has('oauth_next')) {
      return <Navigate to={accountReturnTo(window.location.search)} replace />;
    }
    return (
      <WebAccountStatusShell>
        <div className="web-account-session">
          <img src="/logo.svg" alt="Nimi" className="web-account-logo" draggable={false} />
          <div className="web-account-session-heading">
            <h1>{t('Account.signedInTitle')}</h1>
            <p>{String(currentUser.displayName || currentUser.email || currentUser.id || t('Account.currentAccountFallback'))}</p>
          </div>
          <nav className="web-account-session-actions">
            <Link to="/account" className={`${buttonBase} ${buttonDefault} web-account-session-action`}>
              {t('Account.manageAccount')}
            </Link>
            <Link to="/" className={`${buttonBase} ${buttonOutline} web-account-session-action`}>
              {t('Account.backHome')}
            </Link>
          </nav>
        </div>
      </WebAccountStatusShell>
    );
  }

  return (
    <WebAccountAuthPage
      passwordRecoveryLink={<Link className="underline" to={{ pathname: '/account/recovery', search: window.location.search }}>{t('Auth.forgotPassword')}</Link>}
      adapter={adapter}
      session={{
        mode: 'embedded',
        setAuthSession: (user) => setCurrentUser(user),
      }}
      branding={{ networkLabel: 'Nimi', logo: '/logo.svg', logoAltText: 'Nimi' }}
      appearance={{
        theme: 'custom',
        footerPlacement: 'inside-content',
        rootStyle: webHomeAuthPalette,
      }}
    />
  );
}
