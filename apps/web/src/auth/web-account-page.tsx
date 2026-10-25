import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
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

// Keep the landing homepage neutral surfaces; focus and action accents come
// from the shared Nimi auth theme.
const webHomeAuthPalette = {
  '--nimi-text-primary': '#0f172a',
  '--nimi-text-secondary': '#334155',
  '--nimi-text-muted': '#64748b',
  '--nimi-field-bg': '#ffffff',
  '--nimi-field-border': '#e2e8f0',
  '--nimi-border-subtle': '#e2e8f0',
  '--nimi-elevation-base': '0 6px 18px rgba(15, 23, 42, 0.08)',
  '--nimi-elevation-raised': '0 12px 28px rgba(15, 23, 42, 0.12)',
  '--nimi-elevation-floating': '0 18px 44px rgba(15, 23, 42, 0.16)',
} as CSSProperties;

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
      setSessionError(error instanceof Error ? error.message : t('Account.sessionUnknown'));
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
