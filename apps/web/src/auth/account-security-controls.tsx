import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { createWebBrowserRealm, webRealmOrigin } from './browser-realm.js';
import { loadWebCurrentAccount } from './web-account-adapter.js';
import {
  clearAccountTerminationIntent,
  getAccountTerminationIntent,
  type AccountTerminationReceipt,
} from './account-terminal-state.js';

type SessionPage = RealmModel<'AccountSessionListDto'>;
export function AccountSecurityControls({
  accountId,
  section,
  onSignedOut,
  onVerifyAgain,
  onDeleted,
}: {
  section: 'sessions' | 'delete';
  accountId: string;
  onSignedOut: () => void;
  onVerifyAgain: () => void;
  onDeleted: (receipt: AccountTerminationReceipt) => void;
}) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState<SessionPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<'others' | { id: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const alive = useRef(true);
  const loadSequence = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = async (cursor?: string) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      if ((await loadWebCurrentAccount())?.id !== accountId)
        throw new Error(t('AccountSecurity.accountChanged'));
      if (!alive.current || sequence !== loadSequence.current) return;
      const next = await createWebBrowserRealm().generated.listMyAccountSessions({
        path: {},
        query: { expectedAccountId: accountId, limit: 20, ...(cursor ? { cursor } : {}) },
      });
      if (alive.current && sequence === loadSequence.current)
        setPage((old) => ({
          ...next,
          items: cursor && old ? [...old.items, ...next.items] : next.items,
        }));
    } catch (reason) {
      if (alive.current && sequence === loadSequence.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (alive.current && sequence === loadSequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [accountId]);

  const revokeSelected = async () => {
    if (!revoke || busy) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      if ((await loadWebCurrentAccount())?.id !== accountId)
        throw new Error(t('AccountSecurity.accountChanged'));
      if (!alive.current) return;
      const realm = createWebBrowserRealm();
      const result =
        revoke === 'others'
          ? await realm.generated.revokeMyOtherAccountSessions({
              path: {},
              body: { expectedAccountId: accountId },
            })
          : await realm.generated.revokeMyAccountSession({
              path: { sessionId: revoke.id },
              body: { expectedAccountId: accountId },
            });
      if (!alive.current) return;
      setRevoke(null);
      if (result.currentRevoked) {
        onSignedOut();
        return;
      }
      setFeedback(t('AccountSecurity.revoked'));
      await load();
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const deleteAccount = async () => {
    if (!acknowledged || busy) return;
    setBusy(true);
    setError(null);
    try {
      let intent;
      try {
        intent = getAccountTerminationIntent(
          window.sessionStorage,
          webRealmOrigin(),
          accountId,
          () => crypto.randomUUID(),
        );
      } catch {
        throw new Error(t('AccountSecurity.storageUnavailable'));
      }
      try {
        const result = await createWebBrowserRealm().generated.terminateCurrentAccount({
          path: {},
          body: intent,
        });
        if (!alive.current) return;
        if (result.operation_id !== intent.operation_id)
          throw new Error(t('AccountSecurity.invalidReceipt'));
        try {
          clearAccountTerminationIntent(window.sessionStorage, webRealmOrigin(), intent);
        } catch {
          /* The confirmed server result is still authoritative. */
        }
        onDeleted(result);
      } catch (reason) {
        if (!alive.current) return;
        const code = extractNimiErrorFields(reason).reasonCode;
        if (code === 'AUTH_RECENT_LOGIN_REQUIRED') {
          setPage((old) => (old ? { ...old, recentAuthentication: false } : old));
          setError(t('AccountSecurity.freshRequired'));
        } else if (code === 'ADMIN_LAST_ACTIVE_REQUIRED') {
          setUncertain(false); setError(t('AccountSecurity.lastAdmin'));
        } else if (code === 'AUTH_ACCOUNT_CONTEXT_CHANGED')
          setError(t('AccountSecurity.accountChanged'));
        else {
          setUncertain(true);
          setError(t('AccountSecurity.unknown'));
        }
      }
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <>
      {section === 'sessions' ? (
        <section className="ac-section ac-session-panel" aria-label={t('AccountSecurity.sessions')}>
          <p>{t('AccountSecurity.sessionsBody')}</p>
          {page ? (
            <ul className="web-account-session-list">
              {page.items.map((session) => (
                <li key={session.id}>
                  <div>
                    <strong>
                      {t(session.current ? 'AccountSecurity.current' : 'AccountSecurity.other')}
                    </strong>
                    <span>
                      {session.authenticatedAt ? (
                        <>
                          {t('AccountSecurity.verified')}{' '}
                          {new Date(session.authenticatedAt).toLocaleString(i18n.language)}
                        </>
                      ) : (
                        <>
                          {t('AccountSecurity.verificationUnknown')} ·{' '}
                          {t('AccountSecurity.created')}{' '}
                          {new Date(session.createdAt).toLocaleString(i18n.language)}
                        </>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRevoke({ id: session.id })}
                  >
                    {t('AccountSecurity.revoke')}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {loading ? <p role="status">{t('AccountSecurity.loading')}</p> : null}
          {!loading && !page ? (
            <button type="button" onClick={() => void load()}>
              {t('AccountSecurity.retry')}
            </button>
          ) : null}
          {page?.nextCursor ? (
            <button
              type="button"
              disabled={loading || busy}
              onClick={() => void load(page.nextCursor!)}
            >
              {t('AccountSecurity.loadMore')}
            </button>
          ) : null}
          {page ? (
            <button type="button" disabled={busy} onClick={() => setRevoke('others')}>
              {t('AccountSecurity.revokeOthers')}
            </button>
          ) : null}
          {revoke ? (
            <div
              className="web-account-confirmation"
              role="group"
              aria-label={t('AccountSecurity.confirm')}
            >
              <p>
                {t(
                  revoke === 'others'
                    ? 'AccountSecurity.othersConfirm'
                    : 'AccountSecurity.revokeConfirm',
                )}
              </p>
              <button type="button" disabled={busy} onClick={() => void revokeSelected()}>
                {t('AccountSecurity.confirm')}
              </button>{' '}
              <button type="button" disabled={busy} onClick={() => setRevoke(null)}>
                {t('AccountSecurity.cancel')}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      {section === 'delete' ? (
        <section
          className="ac-section ac-delete-panel"
          aria-label={t('AccountSecurity.deleteTitle')}
        >
          <p>{t('AccountSecurity.deleteBody')}</p>
          {!deleteOpen ? (
            <button type="button" onClick={() => setDeleteOpen(true)}>
              {t('AccountSecurity.deleteStart')}
            </button>
          ) : (
            <>
              <p>{t('AccountSecurity.localEffect')}</p>
              <p>{t('AccountSecurity.retained')}</p>
              {!page && !uncertain ? (
                loading ? (
                  <p role="status">{t('AccountSecurity.loading')}</p>
                ) : <button type="button" onClick={() => void load()}>{t('AccountSecurity.retry')}</button>
              ) : !page?.recentAuthentication && !uncertain ? (
                <>
                  <p>{t('AccountSecurity.freshRequired')}</p>
                  <button type="button" disabled={busy} onClick={onVerifyAgain}>
                    {t('AccountSecurity.reauthenticate')}
                  </button>
                </>
              ) : (
                <>
                  <label className="web-account-check">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(event) => setAcknowledged(event.target.checked)}
                      disabled={busy}
                    />
                    {t('AccountSecurity.acknowledge')}
                  </label>
                  <button
                    className="web-account-danger"
                    type="button"
                    disabled={!acknowledged || busy}
                    onClick={() => void deleteAccount()}
                  >
                    {busy
                      ? t('AccountSecurity.checking')
                      : t('AccountSecurity.deleteFinal')}
                  </button>
                  {uncertain ? (
                    <button type="button" disabled={busy} onClick={onVerifyAgain}>
                      {t('AccountSecurity.reauthenticate')}
                    </button>
                  ) : null}
                </>
              )}
            </>
          )}
        </section>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {feedback ? <p role="status">{feedback}</p> : null}
    </>
  );
}
