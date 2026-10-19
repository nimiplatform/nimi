import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { WebAccountAuthPage } from '@nimiplatform/kit/auth';
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

// Sign-in field surfaces share the landing homepage neutral palette and its
// light-blue focus accent (apps/web/src/landing/styles.css).
const webHomeAuthPalette = {
  '--nimi-text-primary': '#0f172a',
  '--nimi-text-secondary': '#334155',
  '--nimi-text-muted': '#64748b',
  '--nimi-field-bg': '#ffffff',
  '--nimi-field-border': '#e2e8f0',
  '--nimi-field-focus': '#45B8D6',
  '--nimi-focus-ring-color': 'rgba(69, 184, 214, 0.28)',
  '--nimi-border-subtle': '#e2e8f0',
  '--nimi-elevation-base': '0 6px 18px rgba(15, 23, 42, 0.08)',
  '--nimi-elevation-raised': '0 12px 28px rgba(15, 23, 42, 0.12)',
  '--nimi-elevation-floating': '0 18px 44px rgba(15, 23, 42, 0.16)',
} as CSSProperties;

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
    return <main className="web-account-status" role="status">{t('Account.sessionCheck')}</main>;
  }

  if (sessionError) {
    return <main className="web-account-status" role="alert">{sessionError}</main>;
  }

  if (currentUser) {
    return (
      <main className="web-account-status">
        <img src="/logo.svg" alt="Nimi" className="web-account-logo" />
        <h1>{t('Account.signedInTitle')}</h1>
        <p>{String(currentUser.displayName || currentUser.email || currentUser.id || t('Account.currentAccountFallback'))}</p>
        <nav><Link to="/account">{t('Account.manageAccount')}</Link><Link to="/">{t('Account.backHome')}</Link></nav>
      </main>
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
