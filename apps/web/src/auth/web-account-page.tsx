import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
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

function resolveExplicitLang(search: string): 'zh' | 'en' | null {
  const lang = new URLSearchParams(search).get('lang')?.trim().toLowerCase();
  return lang === 'zh' || lang === 'en' ? lang : null;
}

function resolveHomeHref(search: string): string {
  const lang = resolveExplicitLang(search);
  return lang ? `/?lang=${lang}` : '/';
}

function resolveAccountHref(search: string): string {
  const lang = resolveExplicitLang(search);
  return lang ? `/account?lang=${lang}` : '/account';
}

function formatSessionError(error: unknown, fallback: string, isZh: boolean): string {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  const raw = error.message.trim();
  if (/failed to fetch|networkerror|load failed|econnrefused|http 5\d\d|unexpected token|fetch/iu.test(raw)) {
    return isZh
      ? '当前无法连接 Nimi 账号服务，请稍后刷新重试，或先返回官网浏览产品说明。'
      : 'Unable to reach Nimi account services right now. Please retry shortly or return to the website.';
  }
  return raw;
}

export function WebAccountPage() {
  const location = useLocation();
  const activeSearch = location.search || (typeof window === 'undefined' ? '' : window.location.search);
  const homeHref = resolveHomeHref(activeSearch);
  const accountHref = resolveAccountHref(activeSearch);
  const { t, i18n } = useTranslation();
  const explicitLang = resolveExplicitLang(activeSearch);
  useEffect(() => {
    if (explicitLang && i18n.resolvedLanguage !== explicitLang) {
      void i18n.changeLanguage(explicitLang);
    }
  }, [explicitLang, i18n]);
  const isZh = (explicitLang ?? i18n.resolvedLanguage ?? i18n.language ?? '').toLowerCase().startsWith('zh');
  useEffect(() => { document.title = `${t('Auth.signIn')} · Nimi`; }, [t]);
  const adapter = useMemo(() => createWebAccountAuthAdapter(), []);
  const [currentUser, setCurrentUser] = useState<Record<string, unknown> | null>(null);
  const [checking, setChecking] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const search = window.location.search;
      if (new URLSearchParams(search).get('runtime_confirmation') === '1' && accountReturnTo(search).startsWith('/account/connect?')) {
        setCurrentUser(null);
        setChecking(false);
        return;
      }
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
      else setSessionError(formatSessionError(error, t('Account.sessionUnknown'), isZh));
      setChecking(false);
    });
    return () => { active = false; };
  }, [adapter, isZh, t]);

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
        <div className="web-account-session">
          <img src="/logo.svg" alt="Nimi" className="web-account-logo" draggable={false} />
          <div className="web-account-session-heading">
            <h1>{t('Account.pageUnavailable')}</h1>
            <p role="alert">{sessionError}</p>
          </div>
          <nav className="web-account-session-actions">
            <button
              type="button"
              className={`${buttonBase} ${buttonDefault} web-account-session-action`}
              onClick={() => window.location.reload()}
            >
              {t('AccountSecurity.retry')}
            </button>
            <Link to={homeHref} className={`${buttonBase} ${buttonOutline} web-account-session-action`}>
              {t('Account.backHome')}
            </Link>
          </nav>
        </div>
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
            <Link to={accountHref} className={`${buttonBase} ${buttonDefault} web-account-session-action`}>
              {t('Account.manageAccount')}
            </Link>
            <Link to={homeHref} className={`${buttonBase} ${buttonOutline} web-account-session-action`}>
              {t('Account.backHome')}
            </Link>
          </nav>
        </div>
      </WebAccountStatusShell>
    );
  }

  return (
    <WebAccountAuthPage
      passwordRecoveryLink={<Link className="underline" to={{ pathname: '/account/recovery', search: activeSearch }}>{t('Auth.forgotPassword')}</Link>}
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
      footer={(
        <div className="mt-6 flex justify-center">
          <Link
            to={homeHref}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] transition hover:bg-black/5 hover:text-[var(--nimi-text-primary)]"
          >
            <span aria-hidden="true">←</span>
            <span>{t('Account.backHome')}</span>
          </Link>
        </div>
      )}
    />
  );
}
