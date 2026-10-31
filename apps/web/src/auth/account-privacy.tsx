import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { type RealmModel } from '@nimiplatform/sdk/realm';
import { createWebBrowserRealm } from './browser-realm.js';
import { loadWebCurrentAccount } from './web-account-adapter.js';
import { AccountFeedback, AccountHeading } from './account-center-layout.js';
import { accountReadProblem, useAccountCopy } from './account-center-copy.js';

const privacyFields = [
  'profileVisibility',
  'friendListVisibility',
  'dmVisibility',
  'friendRequestVisibility',
  'onlineStatusVisibility',
] as const;
type Settings = RealmModel<'UserSettingsDto'>;
export function AccountPrivacy({
  accountId,
  onDirty,
}: {
  accountId: string;
  onDirty: (dirty: boolean) => void;
}) {
  const c = useAccountCopy();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef(true);
  const changed = privacyFields.filter((key) => saved && draft[key] !== saved[key]);
  useEffect(() => {
    onDirty(changed.length > 0);
  }, [changed.length, onDirty]);
  const load = () => {
    setError(null);
    return loadWebCurrentAccount()
      .then((current) => {
        if (current?.id !== accountId) throw new Error(c('changed'));
        return createWebBrowserRealm().account.getMySettings({ path: {} });
      })
      .then((result) => {
        if (active.current) {
          setSaved(result);
          setDraft(result);
        }
      })
      .catch((reason) => {
        if (active.current) setError(accountReadProblem(reason, c));
      });
  };
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      onDirty(false);
    };
  }, [accountId, onDirty]);
  return (
    <>
      <AccountHeading title={c('privacy')} description={c('privacyIntro')} />
      <AccountFeedback error={error} message={message} />
      {!saved ? (
        <div className="ac-section">
          {error ? (
            <button className="ac-button" onClick={() => void load()}>
              {c('retry')}
            </button>
          ) : (
            <p role="status">{c('loading')}</p>
          )}
        </div>
      ) : (
        <form
          className="ac-section"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!changed.length || busy) return;
            setBusy(true);
            setError(null);
            setMessage(null);
            try {
              if ((await loadWebCurrentAccount())?.id !== accountId) throw new Error(c('changed'));
              if (!active.current) return;
              const result = await createWebBrowserRealm().account.updateMySettings({
                path: {},
                body: Object.fromEntries(changed.map((key) => [key, draft[key]])),
              });
              if (active.current) {
                setSaved(result);
                setDraft(result);
                setMessage(c('saved'));
              }
            } catch (reason) {
              if (active.current)
                setError(reason instanceof Error ? reason.message : c('unavailable'));
            } finally {
              if (active.current) setBusy(false);
            }
          }}
        >
          {privacyFields.map((key) => (
            <label className="ac-privacy-row" key={key}>
              <span>
                <strong>{c(key)}</strong>
                {key === 'friendRequestVisibility' ? <small>{c('requestPolicy')}</small> : null}
              </span>
              <select
                value={draft[key] ?? ''}
                required
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              >
                {draft[key] === undefined ? (
                  <option value="" disabled>
                    —
                  </option>
                ) : null}
                {key === 'friendRequestVisibility' ? (
                  <>
                    <option value="PUBLIC">{c('allowed')}</option>
                    <option value="PRIVATE">{c('closed')}</option>
                  </>
                ) : (
                  <>
                    <option value="PUBLIC">{c('everyone')}</option>
                    <option value="FRIENDS">{c('friendsOnly')}</option>
                    <option value="PRIVATE">
                      {c(key === 'dmVisibility' ? 'nobody' : 'onlyMe')}
                    </option>
                  </>
                )}
              </select>
            </label>
          ))}
          <div className="ac-form-footer">
            <p>{c('privacyNote')}</p>
            <div className="ac-actions">
              <button
                type="button"
                className="ac-button ac-button--secondary"
                disabled={busy || !changed.length}
                onClick={() => {
                  setDraft(saved);
                  setError(null);
                  setMessage(null);
                }}
              >
                {c('cancel')}
              </button>
              <button className="ac-button" disabled={busy || !changed.length}>
                {busy ? c('saving') : c('save')}
              </button>
            </div>
          </div>
        </form>
      )}
      <Link className="ac-text-link ac-bottom-link" to="/account/friends?view=blocked">
        {c('blocked')}
      </Link>
    </>
  );
}
