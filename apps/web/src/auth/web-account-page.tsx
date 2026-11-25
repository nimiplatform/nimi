import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { accountReturnTo, resolveWebAuthHeadingKey } from './account-center-model.js';
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
import { resolveWebAuthAlternatives } from './web-provider-link.js';
import { webHomeAuthPalette } from './web-auth-appearance.js';
import type { AccountRouteContext } from '../site-router.js';
import { BrowserSessionRenewalBlockedError } from './browser-session-reader.js';
import { LanguageToggle } from '../landing/components/language-toggle.js';
import {
  applyLocaleToLocation,
  persistLocale,
  type LandingLocale,
} from '../landing/i18n/locale.js';
import { loadWebLocaleFont } from '../fonts.js';

const AUTH_LOCALE_OPTIONS = {
  zh: {
    en: 'English',
    zh: '中文',
    switchToEn: '切换为英文',
    switchToZh: '切换为中文',
  },
  en: {
    en: 'English',
    zh: '中文',
    switchToEn: 'Switch to English',
    switchToZh: 'Switch to Chinese',
  },
} as const;

// Keep the landing homepage neutral surfaces; focus and action accents come
// from the shared Nimi auth theme.
function WebAccountStatusShell({ header, children }: { header?: ReactNode; children: ReactNode }) {
  return (
    <main
      className="nimi-shell-auth-root nimi-shell-auth-brand-surface web-account-session-page"
      data-shell-auth-theme="custom"
      style={webHomeAuthPalette}
    >
      {header ? (
        <div className="nimi-shell-auth-topbar">
          {header}
        </div>
      ) : null}
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

function resolveDownloadHref(search: string): string {
  const lang = resolveExplicitLang(search);
  return lang ? `/download?lang=${lang}` : '/download';
}

function resolveAccountHref(search: string): string {
  const lang = resolveExplicitLang(search);
  return lang ? `/account?lang=${lang}` : '/account';
}

function formatSessionError(error: unknown, fallback: string, isZh: boolean): string {
  if (error instanceof BrowserSessionRenewalBlockedError) return isZh
    ? '登录状态无法自动续期，请重新登录后继续。已保存的数据保持不变。'
    : 'Automatic session renewal is unavailable. Sign in again to continue; your saved data is unchanged.';
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
  const navigate = useNavigate();
  const confirmation = useOutletContext<AccountRouteContext>();
  const activeSearch = location.search || (typeof window === 'undefined' ? '' : window.location.search);
  const params = new URLSearchParams(activeSearch);
  const ordinaryLogin = (location.pathname === '/login' || location.pathname === '/register')
    && !params.has('oauth_next') && !params.has('runtime_confirmation');
  const returnTo = params.has('returnTo') && !params.has('oauth_next')
    ? accountReturnTo(activeSearch)
    : null;
  const homeHref = resolveHomeHref(activeSearch);
  const downloadHref = resolveDownloadHref(activeSearch);
  const accountHref = resolveAccountHref(activeSearch);
  const { t, i18n } = useTranslation();
  const explicitLang = resolveExplicitLang(activeSearch);
  useEffect(() => {
    if (explicitLang && i18n.resolvedLanguage !== explicitLang) {
      void i18n.changeLanguage(explicitLang);
    }
  }, [explicitLang, i18n]);
  const isZh = (explicitLang ?? i18n.resolvedLanguage ?? i18n.language ?? '').toLowerCase().startsWith('zh');
  const locale: LandingLocale = isZh ? 'zh' : 'en';
  const headingKey = resolveWebAuthHeadingKey(location.pathname, activeSearch);
  const handleLocaleChange = (next: LandingLocale) => {
    void i18n.changeLanguage(next);
    document.documentElement.lang = next;
    persistLocale(next, window.localStorage);
    loadWebLocaleFont(next);
    void navigate(applyLocaleToLocation(location, next), { replace: true });
  };
  const topbar = (
    <header className="web-auth-topbar">
      <Link to={homeHref} className="web-auth-brand" aria-label={t('Account.backHome')}>
        <img src="/logo.svg" alt="" width={28} height={28} draggable={false} />
        <strong>Nimi</strong>
      </Link>
      <LanguageToggle
        locale={locale}
        label={isZh ? '语言' : 'Language'}
        options={AUTH_LOCALE_OPTIONS[locale]}
        onChange={handleLocaleChange}
      />
    </header>
  );
  useEffect(() => { document.title = `${t('Auth.signIn')} · Nimi`; }, [t]);
  const sessionCheck = useRef<Promise<boolean> | null>(null);
  const adapter = useMemo(() => createWebAccountAuthAdapter(undefined, async () => {
    // A refresh in progress can set the same cookies as a credential submission.
    const check = sessionCheck.current;
    if (!check || !(await check) || check !== sessionCheck.current) {
      throw new DOMException('The sign-in form is no longer active.', 'AbortError');
    }
  }), []);
  const [currentUser, setCurrentUser] = useState<Record<string, unknown> | null>(null);
  const [checking, setChecking] = useState(true);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [sessionFailure, setSessionFailure] = useState<{ error: unknown } | null>(null);
  const sessionError = sessionFailure
    ? formatSessionError(sessionFailure.error, t('Account.sessionUnknown'), isZh)
    : null;

  useEffect(() => {
    let active = true;
    const check = (async () => {
      const search = activeSearch;
      setSessionFailure(null);
      if (new URLSearchParams(search).get('runtime_confirmation') === '1' && accountReturnTo(search).startsWith('/account/connect?')) {
        setCurrentUser(null);
        setChecking(false);
        return true;
      }
      const user = await adapter.loadCurrentUser();
      if (!active) return false;
      const oauthNext = readValidatedOauthNext(search);
      const freshOauthContinuation = isFreshOauthContinuation(search);
      const freshAccountSelection = isFreshAccountSelection(search);
      if (user && oauthNext && !freshOauthContinuation) {
        continueOauthNext(search);
        return false;
      }
      if (user && freshAccountSelection) {
        await clearWebBrowserSessionForFreshAccountSelection();
        if (!active) return false;
        if (!continueOauthNext(search)) {
          setSessionFailure({ error: new Error(i18n.t('Account.switchContinuationExpired')) });
          setChecking(false);
        }
        return false;
      }
      setCurrentUser(freshOauthContinuation ? null : user);
      setChecking(false);
      return !user || freshOauthContinuation;
    })().catch((error) => {
      if (!active) return false;
      const deleted = extractNimiErrorFields(error).reasonCode === 'ACCOUNT_DELETED';
      if (deleted) setCurrentUser(null);
      else setSessionFailure({ error });
      setChecking(false);
      return deleted || ordinaryLogin || error instanceof BrowserSessionRenewalBlockedError;
    });
    sessionCheck.current = check;
    return () => {
      active = false;
      sessionCheck.current = null;
    };
  }, [activeSearch, adapter, i18n, ordinaryLogin]);

  const hasOauthNext = params.has('oauth_next');
  const postLoginDestination = hasOauthNext
    ? null
    : (returnTo ?? accountHref);

  useEffect(() => {
    if (!currentUser || !postLoginDestination) return;
    confirmation.current = { loginLocationKey: location.key, account: currentUser };
    void navigate(postLoginDestination, { replace: true, state: location.key });
  }, [confirmation, currentUser, location.key, navigate, postLoginDestination]);

  if (checking && !ordinaryLogin) {
    return (
      <WebAccountStatusShell header={topbar}>
        <p className="web-account-session-message" role="status">{t('Account.sessionCheck')}</p>
      </WebAccountStatusShell>
    );
  }

  if (sessionError && !ordinaryLogin) {
    return (
      <WebAccountStatusShell header={topbar}>
        <div className="web-account-session">
          <img src="/logo.svg" alt="Nimi" className="web-account-logo" draggable={false} />
          <div className="web-account-session-heading">
            <h1>{t('Account.pageUnavailable')}</h1>
            <p role="alert">{sessionError}</p>
          </div>
          <nav className="web-account-session-actions">
            {sessionFailure?.error instanceof BrowserSessionRenewalBlockedError ? <button
              type="button"
              className={`${buttonBase} ${buttonOutline} web-account-session-action`}
              onClick={() => setSessionFailure(null)}
            >
              {isZh ? '重新登录' : 'Sign in again'}
            </button> : null}
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
    if (postLoginDestination) return null;
    return (
      <WebAccountStatusShell header={topbar}>
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
      initialStage="email"
      passwordRecoveryLink={<Link to={{ pathname: '/account/recovery', search: activeSearch }}>{t('Auth.forgotPassword')}</Link>}
      adapter={adapter}
      session={{
        mode: 'embedded',
        authError: sessionError,
        setAuthSession: (user) => setCurrentUser(user),
      }}
      branding={{ networkLabel: 'Nimi', logo: '/logo.svg', logoAltText: 'Nimi' }}
      copy={{ title: t(headingKey) }}
      alternatives={resolveWebAuthAlternatives(adapter, t('Auth.comingSoon'))}
      consent={{
        checked: legalAccepted,
        onChange: setLegalAccepted,
        requiredMessage: t('Auth.legalRequired'),
        lang: locale,
        label: (inputId) => (
          <>
            <label htmlFor={inputId}>{t('Auth.legalPrefix')}</label>
            <a href="/terms.html">{t('Auth.terms')}</a>
            <label htmlFor={inputId}>{t('Auth.legalAnd')}</label>
            <a href="/privacy.html">{t('Auth.privacy')}</a>
          </>
        ),
      }}
      appearance={{
        theme: 'custom',
        footerPlacement: 'inside-content',
        rootStyle: webHomeAuthPalette,
      }}
      header={topbar}
      footer={(
        <footer className="web-auth-footer">
          <nav className="web-auth-footer-links" aria-label={isZh ? '官网导航' : 'Site navigation'}>
            <Link to={homeHref} className="web-auth-footer-link">
              <span aria-hidden="true">←</span>
              <span>{t('Account.backHome')}</span>
            </Link>
            <span aria-hidden="true" className="web-auth-footer-dot">·</span>
            <Link to={downloadHref} className="web-auth-footer-link">
              {t('Auth.downloadHome')}
            </Link>
          </nav>
        </footer>
      )}
    />
  );
}
