import { useCallback, useEffect, useState } from 'react';
import { useNimiAppSession } from '@nimiplatform/kit/auth/app';
import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@nimiplatform/kit/ui';
import {
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  Folder,
  FolderOpen,
  Gauge,
  PanelRight,
  Pencil,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { useI18n } from '../i18n.js';
import { appId } from '../shell/auth/app-identity.js';
import { ModelSettings } from '../shell/model-settings.js';
import { draftsForScope } from './session-drafts.js';
import { errorText, type HarnessView } from './harness-types.js';
import {
  ensureNimiRouteConfig,
  loadNimiModelRouteCatalog,
  type NimiEnsureRouteInput,
  type NimiModelRouteCatalog,
} from './model-routes.js';
import { SessionSidebar } from './session-sidebar.js';
import { TranscriptThread } from './transcript-thread.js';
import { ToolDecision } from './tool-decision.js';
import { TaskComposer } from './task-composer.js';
import { InspectorDrawer, type InspectorTab } from './inspector-drawer.js';

function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

export function Conversations({
  sidebarVisible,
  activeDestination,
  openModels,
  openConversations,
}: {
  sidebarVisible: boolean;
  activeDestination: 'conversations' | 'models';
  openModels(): void;
  openConversations(): void;
}) {
  const { t } = useI18n();
  const [snapshot, setView] = useState<HarnessView>();
  const [viewMode, setViewMode] = useState<'matters' | 'workspace'>('matters');
  const [openingSession, setOpeningSession] = useState(false);
  const [newlyCreated, setNewlyCreated] = useState<string>();
  const view = openingSession ? undefined : snapshot;
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('files');
  const [selectedFile, setSelectedFile] = useState<string>();
  const [workspacePopoverOpen, setWorkspacePopoverOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [adoptingModel, setAdoptingModel] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [records, setRecords] = useState<readonly { configRef: string; name: string; isDefault: boolean }[]>([]);
  const [routeCatalog, setRouteCatalog] = useState<NimiModelRouteCatalog>();
  const [loadingRoutes, setLoadingRoutes] = useState(false);

  const { snapshot: access } = useNimiAppSession();
  const modelScope = access.runtime.status === 'connected' ? access.runtime.scope : undefined;
  const bridge = window.nimiHarness;

  const refreshModelRoutes = useCallback(async () => {
    if (!modelScope) return;
    setLoadingRoutes(true);
    try {
      const catalog = await loadNimiModelRouteCatalog(modelScope.client.aiConfig as never);
      if (!modelScope.signal.aborted) {
        setRouteCatalog(catalog);
        setRecords(catalog.configs.map(c => ({ configRef: c.configRef, name: c.name, isDefault: c.isDefault })));
      }
    } catch (cause) {
      if (!modelScope.signal.aborted) setError(errorText(cause));
    } finally {
      if (!modelScope.signal.aborted) setLoadingRoutes(false);
    }
  }, [modelScope]);

  useEffect(() => {
    if (!modelScope) return;
    void refreshModelRoutes();
    const onFocus = () => { void refreshModelRoutes(); };
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('focus', onFocus); };
  }, [modelScope, refreshModelRoutes]);

  useEffect(() => {
    if (openingSession) return;
    let cancelled = false;
    let reading = false;
    let changedDuringRead = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      if (cancelled || document.hidden) return;
      if (reading) { changedDuringRead = true; return; }
      clearTimeout(retry);
      reading = true;
      try {
        const next = await bridge.snapshot();
        if (!cancelled) { setView(next); setConnectionError(''); }
      } catch (cause) {
        if (!cancelled) {
          setView(undefined);
          setConnectionError(errorText(cause));
          retry = setTimeout(refresh, 1000);
        }
      } finally {
        reading = false;
        if (changedDuringRead && !cancelled) { changedDuringRead = false; void refresh(); }
      }
    }
    const unsubscribe = bridge.onViewChanged(() => { void refresh(); });
    const unsubscribeFocus = bridge.onFocusSession?.(() => {
      openConversations();
      void refresh();
    });
    document.addEventListener('visibilitychange', refresh);
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(retry);
      unsubscribe();
      unsubscribeFocus?.();
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [bridge, openingSession, openConversations]);

  const act = useCallback(async (action: () => Promise<void>) => {
    try { setError(''); await action(); return true; }
    catch (cause) { setError(errorText(cause)); return false; }
  }, []);

  async function openSession(id?: string, configRef?: string, file?: File, pickFolder?: boolean) {
    setOpeningSession(true);
    setSelectedFile(undefined);
    setEditingTitle(false);
    openConversations();
    await act(async () => {
      if (file) {
        if (!modelScope) throw new Error('Connect to Nimi before opening a Home conversation.');
        if (file.size > 1024 * 1024) throw new Error('Choose a Home conversation file up to 1 MiB.');
        const source = await file.text();
        modelScope.signal.throwIfAborted();
        await bridge.importHome(source);
      } else if (id) {
        await bridge.select(id);
      } else {
        let workspaceDir: string | undefined;
        if (pickFolder) {
          const chosen = await bridge.chooseWorkspace();
          if (!chosen) return;
          workspaceDir = chosen;
        }
        await bridge.create(configRef, workspaceDir);
      }
      const next = await bridge.snapshot();
      setNewlyCreated(id ? undefined : next.sessionId);
      setView(next);
    });
    setOpeningSession(false);
  }

  async function switchModelOneClick(targetConfigRef?: string) {
    if (!view) return;
    setAdoptingModel(true);
    await act(async () => {
      const preview = await bridge.reviewModel(view.sessionId, undefined, targetConfigRef ?? view.configRef);
      await bridge.reviewModel(view.sessionId, preview.confirmation, preview.configRef);
      setView(await bridge.snapshot());
    });
    setAdoptingModel(false);
  }

  async function selectRouteOneClick(route: NimiEnsureRouteInput) {
    if (!view || !modelScope) return;
    setAdoptingModel(true);
    await act(async () => {
      const ensured = await ensureNimiRouteConfig(modelScope.client.aiConfig as never, route);
      const preview = await bridge.reviewModel(view.sessionId, undefined, ensured.configRef);
      await bridge.reviewModel(view.sessionId, preview.confirmation, preview.configRef);
      setView(await bridge.snapshot());
      await refreshModelRoutes();
    });
    setAdoptingModel(false);
  }

  async function openHomeAiModels() {
    await act(async () => {
      const result = await openDesktopIntent({ intent: { kind: 'open-apps', appId, section: 'ai-models' } });
      if (result.status !== 'accepted') throw new Error(result.reasonCode);
    });
  }

  async function bindWorkspaceFolder() {
    if (!view) return;
    await act(async () => {
      const chosen = await bridge.chooseWorkspace();
      if (!chosen) return;
      await bridge.setWorkspace(view.sessionId, chosen);
      setSelectedFile(undefined);
      setWorkspacePopoverOpen(false);
      setView(await bridge.snapshot());
    });
  }

  async function exportSessionMarkdown(sessionId: string) {
    await act(async () => {
      const markdown = await bridge.exportMarkdown(sessionId);
      const item = snapshot?.sessions.find(s => s.id === sessionId);
      const slug = (item?.title || 'session').replace(/[^a-zA-Z0-9\u4e00-\u9fff-_]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'session';
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${slug}.md`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  function openFileInInspector(ref: string) {
    setSelectedFile(ref);
    setInspectorTab('files');
    setInspectorOpen(true);
  }

  function applyStarterPrompt(prompt: string) {
    if (!view || !modelScope) return;
    const store = draftsForScope(modelScope);
    const current = store.current(view.sessionId) ?? { text: '', files: [], requestId: crypto.randomUUID() };
    store.put(view.sessionId, { ...current, text: prompt, requestId: crypto.randomUUID() });
    void store.flush(view.sessionId).catch(cause => setError(errorText(cause)));
    setFocusToken(n => n + 1);
  }

  const selectedSession = view?.sessions.find(item => item.id === view.sessionId);
  const selectedTitle = selectedSession?.title ?? t('app.conversations');
  const isConflict = view?.failure === 'ai-config-revision-conflict';
  const genericFailure = isConflict ? undefined : view?.failure;
  const lastRequest = (genericFailure || isConflict)
    ? view?.entries.filter(entry => entry.role === 'user' && !entry.fromHome).at(-1)?.text
    : undefined;

  const totalTokens = view?.usage ? view.usage.inputTokens + view.usage.outputTokens : 0;
  const contextPct = view?.usage && view.contextWindowTokens && view.contextWindowTokens > 0
    ? Math.min(100, Math.round((view.usage.inputTokens / view.contextWindowTokens) * 100))
    : undefined;

  return (
    <div className="harness-workbench" data-testid="nimi-app-workbench" data-sidebar-visible={sidebarVisible}>
      {sidebarVisible && (
        <SessionSidebar
          sessions={snapshot?.sessions ?? []}
          activeSessionId={snapshot?.sessionId}
          activeDestination={activeDestination}
          records={records}
          disabled={!snapshot || openingSession}
          onSelectSession={id => {
            if (activeDestination !== 'conversations') openConversations();
            if (id !== snapshot?.sessionId) void openSession(id);
          }}
          onCreateSession={(ref, pickFolder) => void openSession(undefined, ref, undefined, pickFolder)}
          onImportHomeFile={file => void openSession(undefined, undefined, file)}
          onPinSession={(id, pinned) => void act(() => bridge.pinSession(id, pinned))}
          onRenameSession={(id, title) => void act(() => bridge.rename(id, title))}
          onExportSession={id => void exportSessionMarkdown(id)}
          onDeleteSession={id => void act(async () => {
            await bridge.deleteSession(id);
            setSelectedFile(undefined);
            setView(await bridge.snapshot());
          })}
          onOpenModels={openModels}
        />
      )}

      <div className="harness-center">
        {activeDestination === 'models' ? (
          <ModelSettings onBack={openConversations} />
        ) : (
          <section className="harness-workspace-pane" aria-label={t('app.conversations')}>
            {/* Crisp Workspace Top Bar */}
            <header className="harness-topbar">
              <div className="harness-topbar__title">
                {editingTitle && view ? (
                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      const nextTitle = titleDraft.trim();
                      setEditingTitle(false);
                      if (nextTitle && nextTitle !== selectedTitle) {
                        void act(() => bridge.rename(view.sessionId, nextTitle));
                      }
                    }}
                  >
                    <input
                      autoFocus
                      className="harness-input harness-input--title"
                      maxLength={120}
                      value={titleDraft}
                      placeholder={t('workspace.renamePlaceholder')}
                      onChange={e => setTitleDraft(e.target.value)}
                      onBlur={() => {
                        const nextTitle = titleDraft.trim();
                        setEditingTitle(false);
                        if (nextTitle && nextTitle !== selectedTitle) {
                          void act(() => bridge.rename(view.sessionId, nextTitle));
                        }
                      }}
                      onKeyDown={e => { if (e.key === 'Escape') setEditingTitle(false); }}
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    className="harness-title-btn"
                    title={selectedTitle}
                    disabled={!view}
                    onClick={() => { setTitleDraft(selectedTitle); setEditingTitle(true); }}
                  >
                    <h1>{selectedTitle}</h1>
                    <Pencil size={12} className="harness-title-btn__edit-icon" aria-hidden="true" />
                  </button>
                )}
              </div>

              <div className="harness-topbar__controls">
                {/* Dual Fixed Views Switch: 事项与交付 (default) <-> 项目工作区 */}
                <div className="harness-view-switch" role="tablist" aria-label="视图切换" data-testid="harness-view-switch">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === 'matters'}
                    className={`harness-chip-btn ${viewMode === 'matters' ? 'harness-chip-btn--active' : ''}`}
                    onClick={() => {
                      setViewMode('matters');
                      setInspectorOpen(false);
                    }}
                  >
                    事项与交付
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode === 'workspace'}
                    className={`harness-chip-btn ${viewMode === 'workspace' ? 'harness-chip-btn--active' : ''}`}
                    onClick={() => {
                      setViewMode('workspace');
                      setInspectorTab('files');
                      setInspectorOpen(true);
                    }}
                  >
                    项目工作区
                  </button>
                </div>

                {/* Workspace Chip */}
                {view && (
                  <Popover open={workspacePopoverOpen} onOpenChange={setWorkspacePopoverOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={`harness-chip-btn ${view.workspaceDir ? 'harness-chip-btn--bound' : ''}`}
                        title={view.workspace}
                      >
                        <Folder size={13} aria-hidden="true" />
                        <span className="harness-chip-btn__label">
                          {view.workspaceLabel ?? t('workspace.sandbox')}
                        </span>
                        <ChevronDown size={12} aria-hidden="true" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" side="bottom" className="harness-popover harness-popover--wide">
                      <div className="harness-popover__section">
                        <div className="harness-popover__title">
                          {view.workspaceDir ? t('workspace.localFolder') : t('workspace.sandboxFull')}
                        </div>
                        <code className="harness-path-preview">{view.workspace}</code>
                        {view.running && <p className="harness-muted harness-muted--xs">{t('workspace.stopBeforeSwitch')}</p>}
                      </div>
                      <div className="harness-popover__list">
                        <button
                          type="button"
                          className="harness-popover__item"
                          disabled={view.running}
                          onClick={() => void bindWorkspaceFolder()}
                        >
                          <span className="harness-popover__item-lead">
                            <FolderOpen size={14} aria-hidden="true" />
                            <span>{view.workspaceDir ? t('workspace.switchFolder') : t('workspace.bindFolder')}</span>
                          </span>
                        </button>
                        {view.workspaceDir && (
                          <button
                            type="button"
                            className="harness-popover__item"
                            disabled={view.running}
                            onClick={() => void act(async () => {
                              await bridge.setWorkspace(view.sessionId, null);
                              setSelectedFile(undefined);
                              setWorkspacePopoverOpen(false);
                              setView(await bridge.snapshot());
                            })}
                          >
                            <span className="harness-popover__item-lead">
                              <RotateCcw size={14} aria-hidden="true" />
                              <span>{t('workspace.resetSandbox')}</span>
                            </span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="harness-popover__item"
                          onClick={() => {
                            setWorkspacePopoverOpen(false);
                            void act(() => bridge.revealWorkspace(view.sessionId));
                          }}
                        >
                          <span className="harness-popover__item-lead">
                            <ExternalLink size={14} aria-hidden="true" />
                            <span>{t('workspace.revealFolder')}</span>
                          </span>
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}

                {/* Context Usage Micro-Pill */}
                {view && totalTokens > 0 && (
                  <button
                    type="button"
                    className={`harness-chip-btn harness-chip-btn--subtle ${(contextPct ?? 0) > 80 ? 'harness-chip-btn--warn' : ''}`}
                    title={t('settings.usageTitle')}
                    onClick={() => {
                      setInspectorTab('session');
                      setInspectorOpen(true);
                    }}
                  >
                    <Gauge size={13} aria-hidden="true" />
                    <span>
                      {contextPct !== undefined
                        ? `${formatCompactTokens(totalTokens)} · ${contextPct}%`
                        : t('workspace.contextPill', { used: formatCompactTokens(totalTokens) })}
                    </span>
                  </button>
                )}

                {/* Inspector Drawer Toggle */}
                <button
                  type="button"
                  className={`harness-chip-btn ${inspectorOpen ? 'harness-chip-btn--active' : ''}`}
                  aria-expanded={inspectorOpen}
                  aria-label={t('workspace.inspectorToggle')}
                  title={t('workspace.inspectorToggle')}
                  onClick={() => setInspectorOpen(v => !v)}
                >
                  <PanelRight size={14} aria-hidden="true" />
                  <span>{t('workspace.inspectorToggle')}</span>
                </button>
              </div>
            </header>

            {openingSession && (
              <div className="harness-loading-strip" role="status">{t('transcript.openingSession')}</div>
            )}

            {/* Main Streaming Transcript */}
            {view && (
              <TranscriptThread
                key={view.sessionId}
                view={view}
                openFile={ref => openFileInInspector(ref)}
                onBindWorkspace={() => void bindWorkspaceFolder()}
                onUseStarterPrompt={modelScope ? applyStarterPrompt : undefined}
              />
            )}

            {/* Pre-Write File Recovery Bar (Matters & Deliverables view — typed file edits only) */}
            {view && viewMode === 'matters' && (view.snapshots?.length ?? 0) > 0 && (
              <div className="harness-snapshots-strip" role="region" aria-label="类型化文件写前备份">
                <span className="harness-muted harness-muted--xs">近期文件写入备份（仅限类型化文件改动）：</span>
                {(view.snapshots ?? []).slice(-3).reverse().map(snap => (
                  <button
                    key={snap.snapshotId}
                    type="button"
                    className="harness-chip-btn harness-chip-btn--subtle"
                    disabled={Boolean(snap.restoredAt) || view.running}
                    title={snap.relativePath}
                    onClick={() => void act(async () => {
                      await bridge.restoreSnapshot(view.sessionId, snap.snapshotId);
                      setView(await bridge.snapshot());
                    })}
                  >
                    <RotateCcw size={12} aria-hidden="true" />
                    <span>{snap.restoredAt ? `已恢复 ${snap.relativePath}` : `恢复此次改动前的文件 (${snap.relativePath})`}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Pending Tool Approval Cards */}
            {view && view.decisions.length > 0 && (
              <div className="harness-decisions-dock">
                {view.decisions.map(item => (
                  <ToolDecision
                    key={view.sessionId + ':' + item.id}
                    name={item.name}
                    args={item.args}
                    allowSessionPermitted={item.allowSessionPermitted}
                    isControlPlane={item.isControlPlane}
                    isFreeShell={item.isFreeShell}
                    recentAiEditedWarning={item.recentAiEditedWarning}
                    effect={item.effect}
                    targetDisplayName={item.targetDisplayName}
                    operationDisplayName={item.operationDisplayName}
                    decide={(allow, feedback, allowForSession) =>
                      act(() => bridge.decide(view.sessionId, item.id, allow, feedback, allowForSession, item.revision))
                    }
                  />
                ))}
              </div>
            )}

            {/* One-Click Model Revision Conflict Banner (Contract 2.2) */}
            {view && (isConflict || !view.model) && (
              <div className="harness-conflict-banner" role="alert">
                <AlertTriangle size={16} aria-hidden="true" />
                <div className="harness-conflict-banner__copy">
                  <strong>{isConflict ? t('model.conflictTitle') : t('model.choose')}</strong>
                  <p>{isConflict ? t('model.conflictMessage') : t('model.missingMessage')}</p>
                </div>
                <div className="harness-conflict-banner__actions">
                  {!view.running && (
                    <Button
                      size="sm"
                      disabled={adoptingModel}
                      leadingIcon={<RefreshCw size={13} className={adoptingModel ? 'harness-spin' : ''} />}
                      onClick={() => void switchModelOneClick()}
                    >
                      {t('model.adoptUpdated')}
                    </Button>
                  )}
                  <Button size="sm" tone="ghost" onClick={openModels}>
                    {t('model.openSettings')}
                  </Button>
                </div>
              </div>
            )}

            {(connectionError || error || genericFailure) && (
              <div className="harness-error-banner" role="alert">
                {connectionError || error || genericFailure}
              </div>
            )}

            {/* Unified Floating Composer Card */}
            {view && modelScope && (
              <TaskComposer
                key={modelScope.viewKey + ':' + view.sessionId}
                sessionId={view.sessionId}
                store={draftsForScope(modelScope)}
                focusOnOpen={view.sessionId === newlyCreated}
                focusToken={focusToken}
                lastRequest={lastRequest}
                canSend={Boolean(view.model) && !view.needsResume}
                queue={view.running && !view.needsResume}
                running={view.running}
                needsResume={view.needsResume}
                hasDecisions={view.decisions.length > 0}
                stopped={view.stopped}
                queued={view.queued}
                modelLabel={view.model}
                configRef={view.configRef}
                records={records}
                routeCatalog={routeCatalog}
                loadingRoutes={loadingRoutes}
                reasoningChoices={view.reasoningChoices}
                reasoningEffort={view.reasoningEffort}
                permissionMode={view.permissionMode}
                report={setError}
                openFile={ref => openFileInInspector(ref)}
                onSelectModel={ref => switchModelOneClick(ref)}
                onSelectRoute={route => selectRouteOneClick(route)}
                onRefreshRoutes={() => void refreshModelRoutes()}
                onOpenHomeModels={() => void openHomeAiModels()}
                onSelectReasoningEffort={async effort => {
                  await act(async () => {
                    await bridge.setReasoningEffort(view.sessionId, effort === 'default' ? null : effort);
                    setView(await bridge.snapshot());
                  });
                }}
                onSelectPermissionMode={async mode => {
                  await act(async () => {
                    await bridge.setPermissionMode(view.sessionId, mode);
                    setView(await bridge.snapshot());
                  });
                }}
                onOpenModels={openModels}
                onStop={() => void act(() => bridge.stop(view.sessionId))}
                onResume={() => void act(() => bridge.resume(view.sessionId))}
                onWithdraw={inputId => void act(() => bridge.withdraw(view.sessionId, inputId))}
              />
            )}
          </section>
        )}
      </div>

      {/* Collapsible Right Inspector Drawer (never replaces transcript) */}
      {activeDestination === 'conversations' && inspectorOpen && view && (
        <InspectorDrawer
          tab={inspectorTab}
          onTabChange={setInspectorTab}
          onClose={() => setInspectorOpen(false)}
          view={view}
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
          scope={modelScope}
          drafts={modelScope && draftsForScope(modelScope)}
          report={setError}
        />
      )}
    </div>
  );
}
