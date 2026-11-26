import { useCallback, useEffect, useRef, useState } from 'react';
import type { NimiAppScope } from '@nimiplatform/kit/auth/app';
import { extractNimiErrorFields, isJsonObject } from '@nimiplatform/sdk/types';
import { Button } from '@nimiplatform/kit/ui';
import { ChevronLeft, Folder, FolderTree, Loader2, MessageSquare, Plus, RefreshCw } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { invokeSessionOperation } from './integration-call.js';
import { RemoteSessionInput } from './session-input.js';
import { RemoteSessionFiles } from './session-files.js';

type Row = {
  id: string;
  title: string;
  status?: 'idle' | 'running' | 'waiting' | 'error';
  hasPendingDecision?: boolean;
  workspaceLabel?: string;
  updatedAt?: number;
};

type Page = { sessions: Row[]; nextOffset: number | null };

function parsePage(json: string, offset: number): Page {
  const page = JSON.parse(json);
  if (!page || !Array.isArray(page.sessions) || page.sessions.length > 32
    || page.sessions.some((row: unknown) => !row || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'string' || !('title' in row) || typeof row.title !== 'string')
    || (page.nextOffset !== null && (page.sessions.length === 0 || page.nextOffset !== offset + page.sessions.length))) {
    throw new Error('The PC returned an invalid session list.');
  }
  return page;
}

export function RemoteSessions({
  scope,
  integrationId = 'ai.nimi.harness.sessions.v1',
}: {
  scope: NimiAppScope;
  integrationId?: string;
}) {
  const { t } = useI18n();
  const [targets, setTargets] = useState<{ targetRef: string; displayName: string; permittedOperations: readonly string[] }[]>([]);
  const [selected, setSelected] = useState('');
  const [page, setPage] = useState<Page>();
  const [session, setSession] = useState<Row>();
  const [activeTab, setActiveTab] = useState<'chat' | 'files'>('chat');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const sequence = useRef(0);
  const connection = useRef<AbortController | null>(null);
  const creating = useRef(false);
  const chatTabRef = useRef<HTMLButtonElement>(null);
  const filesTabRef = useRef<HTMLButtonElement>(null);

  const target = targets.find(item => item.targetRef === selected);
  const hasOp = (op: string) => target?.permittedOperations.includes(op) === true;
  const mayList = hasOp('session.list');
  const mayHistory = hasOp('session.getHistory');
  const mayCreate = hasOp('session.create');
  const maySend = hasOp('session.submit');
  const mayStop = hasOp('session.stopInput');
  const mayObserve = hasOp('session.observeProgress');
  const mayReview = hasOp('session.reviewDecision');
  const mayResolve = hasOp('session.resolveDecision');
  const mayListFiles = hasOp('session.listFiles');
  const mayUpload = hasOp('session.importAttachment');
  const mayDownload = hasOp('session.downloadResult');

  const loadList = useCallback(async (targetRef: string, offset: number) => {
    if (!targetRef || !connection.current) return;
    const id = ++sequence.current;
    const current = () => id === sequence.current && !scope.signal.aborted;
    setBusy(true);
    setError('');
    try {
      const signal = AbortSignal.any([scope.signal, connection.current.signal]);
      const json = await invokeSessionOperation(scope, targetRef, 'session.list', { offset }, signal);
      if (!current()) return;
      const next = parsePage(json, offset);
      setPage(previous => ({
        sessions: offset === 0 ? next.sessions : [...(previous?.sessions ?? []), ...next.sessions],
        nextOffset: next.nextOffset,
      }));
      // Update active session title if matched.
      setSession(prev => {
        if (!prev) return prev;
        const found = next.sessions.find(item => item.id === prev.id);
        return found ? { ...prev, ...found } : prev;
      });
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current()) setBusy(false);
    }
  }, [scope]);

  // Auto-discover PC providers & auto-load sessions on mount.
  useEffect(() => {
    const id = ++sequence.current;
    const controller = new AbortController();
    connection.current = controller;
    setBusy(true);
    setError('');
    setPage(undefined);
    setSession(undefined);
    setSelected('');
    setTargets([]);

    scope.client.integration.listCatalog().then(async items => {
      if (id !== sequence.current || scope.signal.aborted) return;
      const choices = items.filter(item => item.integrationId === integrationId && item.available);
      setTargets(choices);
      let chosenRef = choices.length === 1 ? choices[0].targetRef : '';
      let restoredSession: Row | undefined;
      try {
        const { value } = await scope.client.storage.readJson('last-observed-session.json');
        if (id === sequence.current && !scope.signal.aborted && isJsonObject(value)) {
          const source = choices.find(choice => choice.targetRef === value.target);
          if (source && typeof value.sessionId === 'string') {
            chosenRef = source.targetRef;
            restoredSession = { id: value.sessionId, title: typeof value.title === 'string' ? value.title : 'Selected PC session' };
          }
        }
      } catch (cause) {
        if (extractNimiErrorFields(cause).reasonCode !== 'APP_STORAGE_ENTRY_NOT_FOUND') throw cause;
      }
      if (id !== sequence.current || scope.signal.aborted) return;
      if (chosenRef) setSelected(chosenRef);
      if (restoredSession) setSession(restoredSession);

      const chosen = choices.find(c => c.targetRef === chosenRef);
      if (chosen && chosen.permittedOperations.includes('session.list')) {
        await loadList(chosen.targetRef, 0);
      }
    }).catch(cause => {
      if (id === sequence.current && !scope.signal.aborted) setError(cause.message ?? String(cause));
    }).finally(() => {
      if (id === sequence.current && !scope.signal.aborted) setBusy(false);
    });
    return () => { ++sequence.current; controller.abort(); };
  }, [scope, integrationId, refresh, loadList]);

  function openSession(row: Row) {
    setSession(row);
    setActiveTab('chat');
    if (selected) {
      void scope.client.storage.writeJson('last-observed-session.json', { target: selected, sessionId: row.id, title: row.title })
        .catch(() => {});
    }
  }

  async function createSession() {
    if (!selected || !connection.current || creating.current) return;
    const signal = AbortSignal.any([scope.signal, connection.current.signal]);
    creating.current = true;
    setBusy(true);
    setError('');
    try {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(selected));
      const key = 'remote-create-' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('') + '.json';
      signal.throwIfAborted();
      let requestId: string | undefined;
      try {
        const { value } = await scope.client.storage.readJson(key);
        if (!isJsonObject(value) || typeof value.requestId !== 'string'
          || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value.requestId) || typeof value.pending !== 'boolean') {
          throw new Error('Invalid saved session request.');
        }
        if (value.pending) requestId = value.requestId;
      } catch (cause) {
        if (extractNimiErrorFields(cause).reasonCode !== 'APP_STORAGE_ENTRY_NOT_FOUND') throw cause;
      }
      signal.throwIfAborted();
      if (!requestId) {
        requestId = crypto.randomUUID();
        await scope.client.storage.writeJson(key, { requestId, pending: true });
      }
      const row = JSON.parse(await invokeSessionOperation(scope, selected, 'session.create', { requestId }, signal)) as Row;
      if (!row || typeof row.id !== 'string' || typeof row.title !== 'string') throw new Error('The PC returned an invalid session.');
      await scope.client.storage.writeJson(key, { requestId, pending: false });
      signal.throwIfAborted();
      setPage(prev => ({
        sessions: [row, ...(prev?.sessions.filter(item => item.id !== row.id) ?? [])],
        nextOffset: prev?.nextOffset ?? null,
      }));
      openSession(row);
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      creating.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="harness-remote-layout" data-has-session={Boolean(session)}>
      {/* Session List Column */}
      <aside className="harness-remote-sidebar" aria-label={t('remote.sessions')}>
        <header className="harness-remote-sidebar__header">
          <h2>{t('remote.sessions')}</h2>
          <div className="harness-remote-sidebar__actions">
            {mayCreate && (
              <Button size="sm" disabled={busy} leadingIcon={<Plus size={14} />} onClick={() => void createSession()}>
                {t('remote.newSession')}
              </Button>
            )}
            <Button
              size="sm"
              tone="ghost"
              disabled={busy}
              leadingIcon={<RefreshCw size={14} className={busy ? 'harness-spin' : ''} />}
              aria-label={t('remote.refresh')}
              onClick={() => {
                if (selected && mayList) void loadList(selected, 0);
                else setRefresh(v => v + 1);
              }}
            />
          </div>
        </header>

        {targets.length > 1 && (
          <div className="harness-remote-host-select">
            <label>
              <span>{t('remote.chooseProvider')}</span>
              <select
                className="harness-input"
                value={selected}
                disabled={busy}
                onChange={event => {
                  const nextRef = event.target.value;
                  setSelected(nextRef);
                  setPage(undefined);
                  setSession(undefined);
                  setError('');
                  const nextTarget = targets.find(c => c.targetRef === nextRef);
                  if (nextTarget?.permittedOperations.includes('session.list')) {
                    void loadList(nextRef, 0);
                  }
                }}
              >
                <option value="">{t('remote.chooseProvider')}</option>
                {targets.map(item => (
                  <option key={item.targetRef} value={item.targetRef}>
                    {item.displayName} · {item.targetRef.slice(-8)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {!busy && !error && targets.length === 0 && (
          <p className="harness-muted harness-remote-sidebar__empty">{t('remote.noProviders')}</p>
        )}
        {selected && !mayList && (
          <p className="harness-muted harness-remote-sidebar__empty">{t('remote.noListPerm')}</p>
        )}
        {error && <p className="harness-error harness-remote-sidebar__error" role="alert">{error}</p>}

        {page && (
          <div className="harness-remote-session-list">
            {page.sessions.map(item => {
              const active = session?.id === item.id;
              const status = item.status ?? 'idle';
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`harness-session-row__main harness-remote-session-item ${active ? 'harness-remote-session-item--active' : ''}`}
                  onClick={() => openSession(item)}
                >
                  <span className={`harness-status-indicator harness-status-indicator--${status}`}>
                    {status === 'running' ? <Loader2 size={12} className="harness-spin" /> : <span className="harness-status-dot" />}
                  </span>
                  <span className="harness-session-row__text">
                    <span className="harness-session-row__title">{item.title}</span>
                    <span className="harness-session-row__sub">
                      {item.hasPendingDecision && (
                        <span className="harness-pill harness-pill--warning harness-pill--xs">{t('sidebar.status.waiting')}</span>
                      )}
                      {item.workspaceLabel && (
                        <span className="harness-folder-tag">
                          <Folder size={10} aria-hidden="true" />
                          <span>{item.workspaceLabel}</span>
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
            {page.sessions.length === 0 && (
              <p className="harness-muted harness-remote-sidebar__empty">{t('remote.noSessions')}</p>
            )}
            {page.nextOffset !== null && (
              <Button size="sm" tone="secondary" fullWidth disabled={busy} onClick={() => void loadList(selected, page.nextOffset!)}>
                {t('remote.loadMore')}
              </Button>
            )}
          </div>
        )}
      </aside>

      {/* Active Session Workspace Column */}
      <main className="harness-remote-main">
        {!session || !target ? (
          <div className="harness-remote-empty-pane">
            <MessageSquare size={28} aria-hidden="true" />
            <p>{t('remote.selectSession')}</p>
          </div>
        ) : (
          <>
            <header className="harness-remote-main__header">
              <div className="harness-remote-main__title-group">
                <Button
                  size="sm"
                  tone="ghost"
                  className="harness-remote-back-btn"
                  leadingIcon={<ChevronLeft size={16} />}
                  onClick={() => setSession(undefined)}
                >
                  {t('remote.backSessions')}
                </Button>
                <h2 title={session.title}>{session.title}</h2>
              </div>
              <div
                className="harness-inspector__tabs"
                role="tablist"
                aria-label={t('remote.tabsLabel')}
                onKeyDown={event => {
                  const availableTabs: Array<'chat' | 'files'> = (mayListFiles || mayDownload) ? ['chat', 'files'] : ['chat'];
                  if (availableTabs.length < 2) return;
                  const idx = availableTabs.indexOf(activeTab);
                  let next: 'chat' | 'files' | undefined;
                  if (event.key === 'ArrowRight') next = availableTabs[(idx + 1) % availableTabs.length];
                  else if (event.key === 'ArrowLeft') next = availableTabs[(idx - 1 + availableTabs.length) % availableTabs.length];
                  else if (event.key === 'Home') next = availableTabs[0];
                  else if (event.key === 'End') next = availableTabs[availableTabs.length - 1];
                  if (next) {
                    event.preventDefault();
                    setActiveTab(next);
                    (next === 'chat' ? chatTabRef : filesTabRef).current?.focus();
                  }
                }}
              >
                <button
                  ref={chatTabRef}
                  id="harness-remote-tab-chat"
                  type="button"
                  role="tab"
                  tabIndex={activeTab === 'chat' ? 0 : -1}
                  aria-selected={activeTab === 'chat'}
                  aria-controls="harness-remote-tabpanel"
                  className={`harness-tab-btn ${activeTab === 'chat' ? 'harness-tab-btn--active' : ''}`}
                  onClick={() => setActiveTab('chat')}
                >
                  <MessageSquare size={14} aria-hidden="true" />
                  <span>{t('remote.tabChat')}</span>
                </button>
                {(mayListFiles || mayDownload) && (
                  <button
                    ref={filesTabRef}
                    id="harness-remote-tab-files"
                    type="button"
                    role="tab"
                    tabIndex={activeTab === 'files' ? 0 : -1}
                    aria-selected={activeTab === 'files'}
                    aria-controls="harness-remote-tabpanel"
                    className={`harness-tab-btn ${activeTab === 'files' ? 'harness-tab-btn--active' : ''}`}
                    onClick={() => setActiveTab('files')}
                  >
                    <FolderTree size={14} aria-hidden="true" />
                    <span>{t('remote.tabFiles')}</span>
                  </button>
                )}
              </div>
            </header>

            <div
              id="harness-remote-tabpanel"
              role="tabpanel"
              aria-labelledby={`harness-remote-tab-${activeTab}`}
              className="harness-remote-tabpanel"
            >
              {activeTab === 'chat' ? (
                <RemoteSessionInput
                  key={JSON.stringify([selected, session.id])}
                  scope={scope}
                  target={selected}
                  session={session}
                  mayHistory={mayHistory}
                  mayObserve={mayObserve}
                  maySend={maySend}
                  mayStop={mayStop}
                  mayReview={mayReview}
                  mayResolve={mayResolve}
                  mayUpload={mayUpload}
                />
              ) : (
                <RemoteSessionFiles
                  key={JSON.stringify(['files', selected, session.id])}
                  scope={scope}
                  target={selected}
                  sessionId={session.id}
                  mayListFiles={mayListFiles}
                  mayDownload={mayDownload}
                />
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
