import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useBeforeUnload, useBlocker, useLocation, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { WebAccountAuthPage } from '@nimiplatform/kit/auth';
import { fetchNimiRealmPendingFriendRequests, isNimiRealmExpectedAnonymousSessionError } from '@nimiplatform/sdk/realm';
import { createWebBrowserRealm, webRealmOrigin } from './browser-realm.js';
import { createWebAccountAuthAdapter, loadWebCurrentAccount } from './web-account-adapter.js';
import { AccountSecurityControls } from './account-security-controls.js';
import { AccountExport } from './account-export.js';
import {
  recoverAccountTerminationReceipt,
  type AccountTerminationReceipt,
} from './account-terminal-state.js';
import { webHomeAuthPalette } from './web-auth-appearance.js';
import { resolveWebAuthAlternatives } from './web-account-page.js';
import {
  AccountDraftDialog,
  AccountFeedback,
  AccountFrame,
  AccountHeading,
  AccountSignedOut,
} from './account-center-layout.js';
import { AccountOverview } from './account-overview.js';
import { AccountProfile } from './account-profile.js';
import { AccountPrivacy } from './account-privacy.js';
import { AccountFriends } from './account-friends.js';
import { AccountCredentials } from './account-credentials.js';
import { AccountRuntime } from './account-runtime.js';
import { AccountDownload } from './account-download.js';
import { AccountConnect } from './account-connect.js';
import { accountHandle, accountLoginUrl } from './account-center-model.js';
import { accountReadProblem, useAccountCopy, type AccountCopyKey } from './account-center-copy.js';
import type { AccountRouteContext } from '../site-router.js';
import './account-center.css';

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005a
export function AccountManagementPage() {
  const { t, i18n } = useTranslation();
  const c = useAccountCopy();
  const location = useLocation();
  const confirmation = useOutletContext<AccountRouteContext>();
  const loginLocationKey = useRef<unknown>(location.state);
  const confirmedOnEntry = useRef(false);
  const verifyingDeletion = location.pathname === '/account/delete';
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<AccountTerminationReceipt | null>(null);
  const [verifyingOwner, setVerifyingOwner] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingReceivedCount, setPendingReceivedCount] = useState<number | null>(null);
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
    confirmedOnEntry.current = false;
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
    if (!verifyingOwner && !confirmedOnEntry.current) {
      const entry = confirmation.current;
      confirmation.current = null;
      if (entry && entry.loginLocationKey === loginLocationKey.current) {
        confirmedOnEntry.current = true;
        setUser(entry.account);
        setChecking(false);
      } else {
        void refresh();
      }
    }
    const visible = () => {
      if (!verifyingOwner && document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false;
      request.current += 1;
      document.removeEventListener('visibilitychange', visible);
    };
  }, [confirmation, refresh, verifyingOwner]);
  const currentOwnerId = user ? String(user.id) : null;
  useEffect(() => {
    if (!currentOwnerId) {
      setPendingReceivedCount(null);
      return;
    }
    let active = true;
    void fetchNimiRealmPendingFriendRequests(createWebBrowserRealm(), () => {}, {
      direction: 'received',
      limit: 1,
    })
      .then((page) => {
        if (active) setPendingReceivedCount(page.total);
      })
      .catch(() => {
        if (active) setPendingReceivedCount(null);
      });
    return () => {
      active = false;
    };
  }, [currentOwnerId, location.pathname]);

  useEffect(() => {
    const route = location.pathname.split('/')[2] || '';
    const key = (
      route === 'runtime'
        ? 'runtimeNav'
        : route === 'download'
          ? 'navDownloadDesktop'
          : ['profile', 'friends', 'privacy', 'security', 'sessions', 'connect', 'data', 'delete'].includes(route)
            ? route
            : 'overview'
    ) as AccountCopyKey;
    document.title = `${c(key)} · Nimi`;
    document
      .querySelector<HTMLHeadingElement>('.ac-page-heading h1, .ac-hero-header h1, .ac-portal-greeting h1, .download-hero h1')
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
      confirmedOnEntry.current = false;
      request.current += 1;
      setDirty(false);
      setUser(null);
      if (verify) setVerifyingOwner(owner);
    } catch (reason) {
      if (!mounted.current || observeTerminalError(reason)) return;
      if (isNimiRealmExpectedAnonymousSessionError(reason)) {
        confirmedOnEntry.current = false;
        request.current += 1;
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
          <p>{t(verifyingDeletion ? 'AccountSecurity.reverifyBody' : 'AccountSecurity.verifyOwnershipBody')}</p>
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
          initialStage="email"
          passwordRecoveryLink={<Link to="/account/recovery">{t('Auth.forgotPassword')}</Link>}
          adapter={adapter}
          alternatives={resolveWebAuthAlternatives(t('Auth.comingSoon'))}
          session={{
            mode: 'embedded',
            setAuthSession: (next) => {
              if (!next) return;
              setUser(next);
              setVerifyingOwner(null);
              setError(
                String(next.id) === verifyingOwner ? null : t(verifyingDeletion ? 'AccountSecurity.accountChanged' : 'AccountSecurity.ownerChanged'),
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
      <main
        className="nimi-shell-auth-root nimi-shell-auth-brand-surface web-account-session-page"
        data-shell-auth-theme="custom"
        style={webHomeAuthPalette}
      >
        <div className="nimi-shell-auth-shell">
          <div className="nimi-shell-auth-content" role="status">
            <img className="ac-loading-logo" src="/logo.svg" alt="Nimi" draggable={false} />
            <p className="web-account-session-message">{c('loading')}</p>
          </div>
        </div>
      </main>
    );
  if (!user) {
    const loginUrl = accountLoginUrl(location.pathname, location.search);
    if (!error) {
      return <Navigate to={loginUrl} replace />;
    }
    return (
      <AccountSignedOut
        loginUrl={loginUrl}
        error={error}
        onRetry={() => void refresh()}
      />
    );
  }
  const owner = String(user.id);
  const handle = accountHandle(user.handle);
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
    <AccountFrame
      user={user}
      working={working}
      pendingReceivedCount={pendingReceivedCount}
      onSignOut={() => void signOut()}
    >
      <AccountFeedback error={error} />
      {error ? (
        <button type="button" className="ac-text-button" onClick={() => void refresh()}>
          {c('refresh')}
        </button>
      ) : null}
      <Routes>
        <Route index element={<AccountOverview user={user} pendingReceivedCount={pendingReceivedCount} />} />
        <Route path="connect" element={<AccountConnect key={owner} accountId={owner} displayName={String(user.displayName || user.handle || owner)} />} />
        <Route path="runtime" element={<AccountRuntime key={owner} accountId={owner} userHandle={handle} onVerifyAgain={() => void signOut(true)} />} />
        <Route path="download" element={<AccountDownload />} />
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
