import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Route, Routes, useBeforeUnload, useBlocker, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { WebAccountAuthPage } from '@nimiplatform/kit/auth';
import { isNimiRealmExpectedAnonymousSessionError } from '@nimiplatform/sdk/realm';
import { createWebBrowserRealm, webRealmOrigin } from './browser-realm.js';
import { createWebAccountAuthAdapter, loadWebCurrentAccount } from './web-account-adapter.js';
import { AccountSecurityControls } from './account-security-controls.js';
import { AccountExport } from './account-export.js';
import {
  recoverAccountTerminationReceipt,
  type AccountTerminationReceipt,
} from './account-terminal-state.js';
import { webHomeAuthPalette } from './web-auth-appearance.js';
import {
  AccountDraftDialog,
  AccountFeedback,
  AccountFrame,
  AccountHeading,
  AccountOverview,
  AccountSignedOut,
} from './account-center-layout.js';
import { AccountProfile } from './account-profile.js';
import { AccountPrivacy } from './account-privacy.js';
import { AccountFriends } from './account-friends.js';
import { AccountCredentials } from './account-credentials.js';
import { accountLoginUrl } from './account-center-model.js';
import { accountReadProblem, useAccountCopy, type AccountCopyKey } from './account-center-copy.js';
import './account-center.css';

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005a
export function AccountManagementPage() {
  const { t, i18n } = useTranslation();
  const c = useAccountCopy();
  const location = useLocation();
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<AccountTerminationReceipt | null>(null);
  const [verifyingOwner, setVerifyingOwner] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const request = useRef(0);
  const mounted = useRef(true);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useBeforeUnload(
    useCallback(
      (event) => {
        if (dirty) {
          event.preventDefault();
          event.returnValue = '';
        }
      },
      [dirty],
    ),
  );
  const observeTerminalError = useCallback((reason: unknown): boolean => {
    try {
      const receipt = recoverAccountTerminationReceipt(
        window.sessionStorage,
        webRealmOrigin(),
        reason,
      );
      if (receipt) {
        setDeleted(receipt);
        setUser(null);
        return true;
      }
    } catch {
      /* Local state cannot establish deletion. */
    }
    return false;
  }, []);
  const adapter = useMemo(
    () => createWebAccountAuthAdapter(observeTerminalError),
    [observeTerminalError],
  );
  const refresh = useCallback(async () => {
    const current = ++request.current;
    try {
      const next = await loadWebCurrentAccount();
      if (mounted.current && current === request.current) {
        setUser(next);
        setError(null);
      }
    } catch (reason) {
      if (mounted.current && current === request.current && !observeTerminalError(reason))
        setError(accountReadProblem(reason, c));
    } finally {
      if (mounted.current && current === request.current) setChecking(false);
    }
  }, [observeTerminalError, c]);
  useEffect(() => {
    mounted.current = true;
    if (!verifyingOwner) void refresh();
    const visible = () => {
      if (!verifyingOwner && document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false;
      request.current += 1;
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh, verifyingOwner]);
  useEffect(() => {
    const route = location.pathname.split('/')[2] || '';
    const key = (
      ['profile', 'friends', 'privacy', 'security', 'sessions', 'data', 'delete'].includes(route)
        ? route
        : 'overview'
    ) as AccountCopyKey;
    document.title = `${c(key)} · Nimi`;
    document
      .querySelector<HTMLHeadingElement>('.ac-page-heading h1')
      ?.focus({ preventScroll: true });
  }, [location.pathname, i18n.language]);
  async function signOut(verify = false) {
    if (working || !user) return;
    if (dirty && !window.confirm(c('discard'))) return;
    const owner = String(user.id);
    setWorking(true);
    setError(null);
    try {
      await createWebBrowserRealm('').auth.logout({ path: {}, body: {} });
      if (!mounted.current) return;
      setDirty(false);
      setUser(null);
      if (verify) setVerifyingOwner(owner);
    } catch (reason) {
      if (!mounted.current || observeTerminalError(reason)) return;
      if (isNimiRealmExpectedAnonymousSessionError(reason)) {
        setUser(null);
        if (verify) setVerifyingOwner(owner);
      } else setError(reason instanceof Error ? reason.message : t('Account.logoutFailed'));
    } finally {
      if (mounted.current) setWorking(false);
    }
  }
  if (deleted)
    return (
      <main className="ac-entry">
        <div className="ac-entry-content" role="status">
          <h1>{t('AccountSecurity.deleted')}</h1>
          <p>{t('AccountSecurity.deletedBody')}</p>
          <Link to="/">{c('home')}</Link>
        </div>
      </main>
    );
  if (verifyingOwner)
    return (
      <>
        <div className="web-account-verification-heading">
          <h1>{t('AccountSecurity.reverifyTitle')}</h1>
          <p>{t('AccountSecurity.reverifyBody')}</p>
          <button
            type="button"
            onClick={() => {
              setVerifyingOwner(null);
              setUser(null);
            }}
          >
            {c('cancel')}
          </button>
        </div>
        <WebAccountAuthPage
          passwordRecoveryLink={<Link className="underline" to="/account/recovery">{t('Auth.forgotPassword')}</Link>}
          adapter={adapter}
          session={{
            mode: 'embedded',
            setAuthSession: (next) => {
              if (!next) return;
              setUser(next);
              setVerifyingOwner(null);
              setError(
                String(next.id) === verifyingOwner ? null : t('AccountSecurity.accountChanged'),
              );
            },
          }}
          branding={{ networkLabel: 'Nimi', logo: '/logo.svg', logoAltText: 'Nimi' }}
          appearance={{
            theme: 'custom',
            footerPlacement: 'inside-content',
            rootStyle: webHomeAuthPalette,
          }}
        />
      </>
    );
  if (checking)
    return (
      <main className="ac-entry">
        <div className="ac-entry-content" role="status">
          <img className="ac-loading-logo" src="/logo.svg" alt="Nimi" />
          <p>{c('loading')}</p>
        </div>
      </main>
    );
  if (!user)
    return (
      <AccountSignedOut
        loginUrl={accountLoginUrl(location.pathname, location.search)}
        error={error}
        onRetry={() => void refresh()}
      />
    );
  const owner = String(user.id);
  const sessionControls = (section: 'sessions' | 'delete') => (
    <AccountSecurityControls
      key={`${owner}:${section}`}
      section={section}
      accountId={owner}
      onSignedOut={() => setUser(null)}
      onVerifyAgain={() => void signOut(true)}
      onDeleted={(receipt) => {
        setDeleted(receipt);
        setUser(null);
      }}
    />
  );
  return (
    <AccountFrame user={user} working={working} onSignOut={() => void signOut()}>
      <AccountFeedback error={error} />
      {error ? (
        <button type="button" className="ac-text-button" onClick={() => void refresh()}>
          {c('refresh')}
        </button>
      ) : null}
      <Routes>
        <Route index element={<AccountOverview user={user} />} />
        <Route
          path="profile"
          element={<AccountProfile key={owner} user={user} onSaved={setUser} onDirty={setDirty} />}
        />
        <Route path="friends" element={<AccountFriends key={owner} accountId={owner} />} />
        <Route
          path="privacy"
          element={<AccountPrivacy key={owner} accountId={owner} onDirty={setDirty} />}
        />
        <Route
          path="security"
          element={<AccountCredentials key={owner} user={user} onSaved={setUser} />}
        />
        <Route
          path="sessions"
          element={
            <>
              <AccountHeading title={c('sessions')} description={c('sessionsIntro')} />
              {sessionControls('sessions')}
            </>
          }
        />
        <Route
          path="data"
          element={
            <>
              <AccountHeading title={c('data')} description={c('dataIntro')} />
              <div className="ac-section">
                <AccountExport key={owner} expectedAccountId={owner} />
              </div>
              <section className="ac-section ac-account-deletion">
                <h2>{c('delete')}</h2>
                <p>{c('deleteHint')}</p>
                <Link className="ac-text-link" to="/account/delete">
                  {t('AccountSecurity.deleteStart')}
                </Link>
              </section>
            </>
          }
        />
        <Route
          path="delete"
          element={
            <>
              <AccountHeading title={c('delete')} />
              <Link to="/account/data" className="ac-text-link">
                {c('data')}
              </Link>
              {sessionControls('delete')}
            </>
          }
        />
        <Route
          path="*"
          element={
            <>
              <AccountHeading title={c('notFound')} />
              <Link to="/account">{c('backAccount')}</Link>
            </>
          }
        />
      </Routes>
      <AccountDraftDialog blocker={blocker} />
    </AccountFrame>
  );
}
