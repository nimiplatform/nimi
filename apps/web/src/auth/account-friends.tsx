import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, UserPlus, UsersRound, Inbox, Send, Ban, MoreHorizontal, X } from 'lucide-react';
import {
  applyNimiRealmFriendshipAction,
  fetchNimiRealmPendingFriendRequests,
  loadNimiRealmBlockedUserPage,
  loadNimiRealmFriendListPage,
  type Realm,
} from '@nimiplatform/sdk/realm';
import { createWebBrowserRealm } from './browser-realm.js';
import { loadWebCurrentAccount } from './web-account-adapter.js';
import { AccountAvatar, AccountFeedback, AccountHeading } from './account-center-layout.js';
import { accountReadProblem, useAccountCopy, type AccountCopyKey } from './account-center-copy.js';
import { accountHandle } from './account-center-model.js';
import { asNimiError } from '@nimiplatform/sdk/types';

export function friendRequestFailure(error: unknown): { uncertain: boolean; copy: AccountCopyKey } {
  const status = asNimiError(error).details?.status;
  if (typeof status !== 'number' || status < 400 || status === 408 || status >= 500)
    return { uncertain: true, copy: 'requestUnknown' };
  return {
    uncertain: false,
    copy:
      status === 404
        ? 'userNotFound'
        : status === 403
          ? 'requestDenied'
          : status === 401
            ? 'sessionExpired'
            : status === 429
              ? 'tooManyRequests'
              : 'requestRejected',
  };
}

export type PeopleView = 'friends' | 'received' | 'sent' | 'blocked';
export type AccountPerson = {
  id: string;
  displayName: string | null;
  handle: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  relationshipId?: string;
  isDeleted: boolean;
  requestMessage?: string | null;
};
export type PeoplePage = { items: AccountPerson[]; total: number; nextCursor: string | null };
export async function loadAccountPeople(
  realm: Realm,
  view: PeopleView,
  cursor?: string,
  query?: string,
): Promise<PeoplePage> {
  if (view === 'friends') {
    const page = await loadNimiRealmFriendListPage(realm, { cursor, query, limit: 20 });
    return { ...page, items: [...page.items] };
  }
  if (view === 'blocked') {
    const page = await loadNimiRealmBlockedUserPage(realm, { cursor, limit: 20 });
    return { ...page, items: [...page.items] };
  }
  const page = await fetchNimiRealmPendingFriendRequests(realm, () => {}, {
    cursor,
    direction: view,
    limit: 20,
  });
  return { ...page, items: page.items.map((person) => ({ ...person, id: person.userId })) };
}

type Action = 'accept' | 'reject' | 'cancel' | 'remove' | 'block' | 'unblock';
const tabs = [
  ['friends', 'allFriends'],
  ['received', 'received'],
  ['sent', 'sent'],
  ['blocked', 'blocked'],
] as const;
const empty: Record<PeopleView, [AccountCopyKey, AccountCopyKey, typeof UsersRound]> = {
  friends: ['emptyFriends', 'emptyFriendsBody', UsersRound],
  received: ['emptyReceived', 'emptyReceivedBody', Inbox],
  sent: ['emptySent', 'emptySentBody', Send],
  blocked: ['emptyBlocked', 'emptyBlockedBody', Ban],
};

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005f
export function AccountFriends({ accountId }: { accountId: string }) {
  const c = useAccountCopy();
  const [params, setParams] = useSearchParams();
  const view = tabs.find(([key]) => key === params.get('view'))?.[0] ?? 'friends';
  const [adding, setAdding] = useState(false);
  const [listRevision, setListRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <AccountHeading
        title={c('friends')}
        description={c('friendsIntro')}
        action={
          !adding && (
            <button
              className="ac-button"
              type="button"
              onClick={() => {
                setNotice(null);
                setAdding(true);
              }}
            >
              <UserPlus size={18} />
              {c('add')}
            </button>
          )
        }
      />
      <AccountFeedback message={notice} />
      {adding ? (
        <AddFriend
          accountId={accountId}
          onClose={() => setAdding(false)}
          onSent={(outcome) => {
            setAdding(false);
            setListRevision((value) => value + 1);
            setNotice(
              outcome
                ? c(
                    outcome === 'requested'
                      ? 'requestSent'
                      : outcome === 'accepted'
                        ? 'alreadyFriends'
                        : 'unchanged',
                  )
                : null,
            );
            if (outcome === 'accepted') setParams({});
            else if (outcome !== 'unchanged') setParams({ view: 'sent' });
          }}
        />
      ) : null}
      <nav className="ac-tabs" aria-label={c('friends')}>
        {tabs.map(([key, label]) => (
          <Link
            to={key === 'friends' ? '/account/friends' : `/account/friends?view=${key}`}
            aria-current={key === view ? 'page' : undefined}
            key={key}
          >
            {c(label)}
          </Link>
        ))}
      </nav>
      <PeopleList
        key={`${accountId}:${view}:${listRevision}`}
        accountId={accountId}
        view={view}
        onAdd={() => setAdding(true)}
      />
      <p className="ac-footnote">{c('chatHome')}</p>
    </>
  );
}

function AddFriend({
  accountId,
  onClose,
  onSent,
}: {
  accountId: string;
  onClose: () => void;
  onSent: (outcome: 'requested' | 'accepted' | 'unchanged' | null) => void;
}) {
  const c = useAccountCopy();
  const [handle, setHandle] = useState('');
  const [note, setNote] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return (
    <form
      className="ac-add-friend ac-section"
      onSubmit={async (event) => {
        event.preventDefault();
        if (working || uncertain) return;
        setWorking(true);
        setError(null);
        let submitted = false;
        try {
          if ((await loadWebCurrentAccount())?.id !== accountId) throw new Error(c('changed'));
          if (!active.current) return;
          submitted = true;
          const result = await createWebBrowserRealm().social.addFriendByHandle({
            path: { handle: handle.trim().replace(/^@/, '') },
            body: note.trim() ? { requestMessage: note.trim() } : {},
          });
          if (active.current) onSent(result.outcome);
        } catch (reason) {
          if (active.current) {
            const failure = friendRequestFailure(reason);
            setUncertain(submitted && failure.uncertain);
            setError(
              submitted
                ? c(failure.copy)
                : reason instanceof Error
                  ? reason.message
                  : c('unavailable'),
            );
          }
        } finally {
          if (active.current) setWorking(false);
        }
      }}
    >
      <div className="ac-section-title">
        <h2>{c('add')}</h2>
        <button
          className="ac-icon-button"
          type="button"
          aria-label={c('cancel')}
          onClick={onClose}
          disabled={working}
        >
          <X size={19} />
        </button>
      </div>
      <p>{c('addHint')}</p>
      <label className="ac-field">
        <span>{c('username')}</span>
        <input
          autoFocus
          required
          maxLength={40}
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          placeholder={c('handlePlaceholder')}
          autoComplete="off"
          disabled={working || uncertain}
        />
      </label>
      <label className="ac-field">
        <span>{c('message')}</span>
        <input
          maxLength={200}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={working || uncertain}
        />
      </label>
      <AccountFeedback error={error} />
      <div className="ac-actions">
        {uncertain ? (
          <button type="button" className="ac-button" onClick={() => onSent(null)}>
            {c('checkSent')}
          </button>
        ) : (
          <button className="ac-button" disabled={!handle.trim() || working}>
            {working ? c('sending') : c('sendRequest')}
          </button>
        )}
        <button
          type="button"
          className="ac-button ac-button--secondary"
          disabled={working}
          onClick={onClose}
        >
          {c('cancel')}
        </button>
      </div>
    </form>
  );
}

function PeopleList({
  accountId,
  view,
  onAdd,
}: {
  accountId: string;
  view: PeopleView;
  onAdd: () => void;
}) {
  const c = useAccountCopy();
  const [page, setPage] = useState<PeoplePage | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    person: AccountPerson;
    action: 'remove' | 'block' | 'unblock';
  } | null>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const actionOrigin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (confirm) confirmation.current?.focus();
  }, [confirm]);
  function reviewAction(
    person: AccountPerson,
    kind: 'remove' | 'block' | 'unblock',
    button: HTMLButtonElement,
  ) {
    const menu = button.closest('details');
    actionOrigin.current = menu?.querySelector('summary') ?? button;
    if (menu) menu.open = false;
    setConfirm({ person, action: kind });
  }
  const sequence = useRef(0);
  const active = useRef(true);
  const load = useCallback(
    async (cursor?: string) => {
      const request = ++sequence.current;
      setLoading(true);
      setError(null);
      try {
        if ((await loadWebCurrentAccount())?.id !== accountId) throw new Error(c('changed'));
        if (!active.current || request !== sequence.current) return;
        const next = await loadAccountPeople(createWebBrowserRealm(), view, cursor, search);
        if (!active.current || request !== sequence.current) return;
        setPage((old) => ({
          ...next,
          items:
            cursor && old
              ? [
                  ...old.items,
                  ...next.items.filter(
                    (item) => !old.items.some((previous) => previous.id === item.id),
                  ),
                ]
              : next.items,
        }));
      } catch (reason) {
        if (active.current && request === sequence.current) setError(accountReadProblem(reason, c));
      } finally {
        if (active.current && request === sequence.current) setLoading(false);
      }
    },
    [accountId, view, search, c],
  );
  useEffect(() => {
    active.current = true;
    setPage(null);
    void load();
    return () => {
      active.current = false;
      sequence.current += 1;
    };
  }, [load]);
  async function action(person: AccountPerson, kind: Action) {
    if (busy) return;
    setBusy(person.id);
    setError(null);
    setMessage(null);
    try {
      if ((await loadWebCurrentAccount())?.id !== accountId) throw new Error(c('changed'));
      if (!active.current) return;
      const realm = createWebBrowserRealm();
      if (kind === 'block') await realm.social.blockUser({ path: { id: person.id }, body: {} });
      else if (kind === 'unblock') await realm.social.unblockUser({ path: { id: person.id } });
      else {
        if (!person.relationshipId) throw new Error(c('stateChanged'));
        await applyNimiRealmFriendshipAction(realm, person.id, {
          action: kind,
          relationshipId: person.relationshipId,
        });
      }
      if (!active.current) return;
      setConfirm(null);
      setMessage(c('actionDone'));
      await load();
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : c('stateChanged'));
    } finally {
      if (active.current) setBusy(null);
    }
  }
  const [emptyTitle, emptyBody, EmptyIcon] = empty[view];
  return (
    <div className="ac-people-content">
      <div className="ac-list-toolbar">
        {view === 'friends' ? (
          <form
            className="ac-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(query.trim());
            }}
          >
            <Search size={18} />
            <input
              aria-label={c('search')}
              placeholder={c('search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit" className="ac-text-button">
              {c('searchButton')}
            </button>
          </form>
        ) : (
          <span className="ac-muted">
            {page ? `${c(tabs.find(([key]) => key === view)![1])} · ${page.total}` : c('loading')}
          </span>
        )}
        <button
          type="button"
          className="ac-text-button"
          disabled={loading || Boolean(busy)}
          onClick={() => void load()}
        >
          {c('refresh')}
        </button>
      </div>
      <AccountFeedback error={error} message={message} />
      {loading && !page ? (
        <div className="ac-list-loading" role="status">
          <div />
          <div />
          <div />
          <span>{c('loading')}</span>
        </div>
      ) : null}
      {!loading && !page && error ? (
        <button
          type="button"
          className="ac-button ac-button--secondary"
          onClick={() => void load()}
        >
          {c('retry')}
        </button>
      ) : null}
      {page?.items.length === 0 ? (
        <div className="ac-empty">
          <EmptyIcon size={34} strokeWidth={1.5} />
          <h2>{c(search ? 'noMatches' : emptyTitle)}</h2>
          <p>{c(search ? 'noMatchesBody' : emptyBody)}</p>
          {view === 'friends' && !search ? (
            <button className="ac-button" type="button" onClick={onAdd}>
              <UserPlus size={17} />
              {c('add')}
            </button>
          ) : null}
        </div>
      ) : null}
      {page && page.items.length > 0 ? (
        <>
          <p className="ac-list-count">
            {c(search ? 'searchResults' : tabs.find(([key]) => key === view)![1])}{' '}
            <span>{page.total}</span>
          </p>
          <ul className="ac-people-list">
            {page.items.map((person) => (
              <li key={person.id}>
                <div className="ac-person-row">
                  <AccountAvatar user={person} />
                  <div className="ac-person-copy">
                    <strong>
                      {person.isDeleted ? c('deletedUser') : person.displayName || person.handle}
                    </strong>
                    {!person.isDeleted && person.handle ? (
                      <span>@{accountHandle(person.handle)}</span>
                    ) : null}
                    {!person.isDeleted && (person.requestMessage || person.bio) ? (
                      <p>{person.requestMessage || person.bio}</p>
                    ) : null}
                  </div>
                  <div className="ac-person-actions">
                    {view === 'received' ? (
                      <>
                        <button
                          type="button"
                          className="ac-button ac-button--small"
                          disabled={Boolean(busy) || person.isDeleted}
                          onClick={() => void action(person, 'accept')}
                        >
                          {c('accept')}
                        </button>
                        <button
                          type="button"
                          className="ac-button ac-button--secondary ac-button--small"
                          disabled={Boolean(busy)}
                          onClick={() => void action(person, 'reject')}
                        >
                          {c('reject')}
                        </button>
                      </>
                    ) : view === 'sent' ? (
                      <button
                        type="button"
                        className="ac-button ac-button--secondary ac-button--small"
                        disabled={Boolean(busy)}
                        onClick={() => void action(person, 'cancel')}
                      >
                        {c('cancelRequest')}
                      </button>
                    ) : view === 'blocked' ? (
                      <button
                        type="button"
                        className="ac-button ac-button--secondary ac-button--small"
                        disabled={Boolean(busy)}
                        onClick={(event) => reviewAction(person, 'unblock', event.currentTarget)}
                      >
                        {c('unblock')}
                      </button>
                    ) : (
                      <details className="ac-person-menu">
                        <summary aria-label={`${c('actions')} · ${person.displayName}`}>
                          <MoreHorizontal size={22} />
                        </summary>
                        <div>
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={(event) => reviewAction(person, 'remove', event.currentTarget)}
                          >
                            {c('remove')}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(busy) || person.isDeleted}
                            onClick={(event) => reviewAction(person, 'block', event.currentTarget)}
                          >
                            {c('block')}
                          </button>
                        </div>
                      </details>
                    )}
                  </div>
                </div>
                {confirm?.person.id === person.id ? (
                  <div
                    ref={confirmation}
                    className="ac-inline-confirm"
                    role="group"
                    tabIndex={-1}
                    aria-labelledby={`confirm-${person.id}`}
                  >
                    <p id={`confirm-${person.id}`}>
                      <strong>{person.displayName || person.handle}</strong>
                      {' · '}
                      {c(
                        confirm.action === 'remove'
                          ? 'confirmRemove'
                          : confirm.action === 'block'
                            ? 'confirmBlock'
                            : 'confirmUnblock',
                      )}
                    </p>
                    <div className="ac-actions">
                      <button
                        type="button"
                        className="ac-button ac-button--danger ac-button--small"
                        disabled={Boolean(busy)}
                        onClick={() => void action(confirm.person, confirm.action)}
                      >
                        {c(confirm.action)}
                      </button>
                      <button
                        type="button"
                        className="ac-button ac-button--secondary ac-button--small"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          setConfirm(null);
                          actionOrigin.current?.focus();
                        }}
                      >
                        {c('cancel')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {page?.nextCursor ? (
        <button
          type="button"
          className="ac-button ac-button--secondary ac-load-more"
          disabled={loading || Boolean(busy)}
          onClick={() => void load(page.nextCursor!)}
        >
          {loading ? c('loading') : c('more')}
        </button>
      ) : null}
    </div>
  );
}
