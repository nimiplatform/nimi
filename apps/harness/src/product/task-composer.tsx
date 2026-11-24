import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChatComposer } from '@nimiplatform/kit/features/chat';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@nimiplatform/kit/ui';
import { Brain, Check, ChevronDown, Cloud, Cpu, ExternalLink, Eye, Loader2, Paperclip, Play, Search, Settings, Shield, ShieldCheck, Sparkles, Square, X } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { emptyDraft, type Material, type SessionDrafts, type TaskDraft } from './session-drafts.js';
import type { PermissionMode, ReasoningChoice } from './harness-types.js';
import type { NimiEnsureRouteInput, NimiModelRouteCatalog, NimiSavedConfigOption } from './model-routes.js';

type RouteFilter = 'all' | 'cloud' | 'local' | 'saved';

export function TaskComposer({
  sessionId,
  store,
  canSend,
  queue,
  running,
  needsResume,
  hasDecisions,
  stopped,
  queued,
  modelLabel,
  configRef,
  records,
  routeCatalog,
  loadingRoutes,
  reasoningChoices,
  reasoningEffort,
  permissionMode,
  report,
  openFile,
  focusOnOpen,
  focusToken,
  lastRequest,
  onSelectModel,
  onSelectRoute,
  onRefreshRoutes,
  onOpenHomeModels,
  onSelectReasoningEffort,
  onSelectPermissionMode,
  onOpenModels,
  onStop,
  onResume,
  onWithdraw,
}: {
  sessionId: string;
  store: SessionDrafts;
  canSend: boolean;
  queue: boolean;
  running: boolean;
  needsResume: boolean;
  hasDecisions: boolean;
  stopped: boolean;
  queued: { id: number; text: string }[];
  modelLabel?: string;
  configRef?: string;
  records: readonly { configRef: string; name: string; isDefault: boolean }[];
  routeCatalog?: NimiModelRouteCatalog;
  loadingRoutes?: boolean;
  reasoningChoices: ReasoningChoice[];
  reasoningEffort: string;
  permissionMode: PermissionMode;
  report(message: string): void;
  focusOnOpen: boolean;
  focusToken?: number;
  lastRequest?: string;
  openFile(ref: string, opener: HTMLButtonElement): void;
  onSelectModel(configRef: string): Promise<void>;
  onSelectRoute?(route: NimiEnsureRouteInput): Promise<void>;
  onRefreshRoutes?(): void;
  onOpenHomeModels?(): void;
  onSelectReasoningEffort(effort: string): Promise<void>;
  onSelectPermissionMode(mode: PermissionMode): Promise<void>;
  onOpenModels(): void;
  onStop(): void;
  onResume(): void;
  onWithdraw(inputId: number): void;
}) {
  const { t } = useI18n();
  const draft = useSyncExternalStore(store.subscribe, () => store.current(sessionId));
  const composer = useRef<HTMLDivElement>(null);
  const initialFocus = useRef(focusOnOpen);
  const draftReady = Boolean(draft);
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const [permPopoverOpen, setPermPopoverOpen] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [routeFilter, setRouteFilter] = useState<RouteFilter>('all');

  useEffect(() => {
    if (draftReady && initialFocus.current) {
      initialFocus.current = false;
      composer.current?.querySelector('textarea')?.focus({ preventScroll: true });
    }
  }, [draftReady]);

  useEffect(() => {
    if (focusToken) {
      const textarea = composer.current?.querySelector('textarea');
      if (textarea) {
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
    }
  }, [focusToken]);

  const [importing, setImporting] = useState(false);
  const mounted = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  const importingNow = useRef(false);
  const showError = (error: unknown) => { if (mounted.current) report(error instanceof Error ? error.message : String(error)); };

  function flush() {
    clearTimeout(timer.current);
    if (!dirty.current) return Promise.resolve();
    dirty.current = false;
    return store.flush(sessionId).catch(err => { dirty.current = true; throw err; });
  }

  useEffect(() => {
    mounted.current = true;
    void store.load(sessionId).catch(showError);
    return () => { mounted.current = false; void flush().catch(showError); };
  }, [sessionId, store]);

  function update(next: TaskDraft) {
    store.put(sessionId, next);
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().catch(showError), 250);
  }

  function edit(patch: Partial<Pick<TaskDraft, 'text' | 'files'>>) {
    const current = store.current(sessionId);
    if (!current || (patch.text === current.text) || (patch.files?.length === 0 && !current.files.length)) return;
    update({ ...current, ...patch, requestId: crypto.randomUUID() });
  }

  async function importFiles(files: File[]) {
    if (!files.length || importingNow.current) return;
    importingNow.current = true;
    setImporting(true);
    try {
      await store.load(sessionId);
      for (const file of files) {
        if (file.size > 32 * 1024 * 1024) throw new Error('Choose a file up to 32 MiB.');
        const material = await window.nimiHarness.importMaterial(sessionId, file.name, new Uint8Array(await file.arrayBuffer()));
        const current = store.current(sessionId);
        if (current) edit({ files: [...current.files, material] });
      }
      await flush();
    } catch (err) {
      showError(err);
    } finally {
      importingNow.current = false;
      if (mounted.current) setImporting(false);
    }
  }

  function effortLabel(val: string): string {
    const key = `model.reasoning.${val}` as const;
    const mapped = t(key as never);
    return mapped === key ? val : mapped;
  }

  const savedOptions = useMemo<readonly NimiSavedConfigOption[]>(() => {
    if (routeCatalog?.configs.length) return routeCatalog.configs;
    return records.map(r => ({
      configRef: r.configRef,
      name: r.name,
      isDefault: r.isDefault,
      revision: '',
      routeKind: 'unset' as const,
      ready: true,
    }));
  }, [routeCatalog, records]);

  const activeConfigRef = configRef || savedOptions.find(c => c.isDefault)?.configRef;
  const searchQuery = modelSearch.trim().toLowerCase();

  const filteredSaved = useMemo(() => {
    if (routeFilter !== 'all' && routeFilter !== 'saved') return [];
    return savedOptions.filter(item => {
      if (!searchQuery) return true;
      const hay = [item.name, item.targetLabel, item.connectorLabel, item.provider, item.routeKind].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(searchQuery);
    });
  }, [savedOptions, routeFilter, searchQuery]);

  const showLocalSection = useMemo(() => {
    if (!routeCatalog) return false;
    if (routeFilter !== 'all' && routeFilter !== 'local') return false;
    if (!searchQuery) return true;
    const hay = ['local', '本机', 'on-device', routeCatalog.local.label ?? ''].join(' ').toLowerCase();
    return hay.includes(searchQuery);
  }, [routeCatalog, routeFilter, searchQuery]);

  const filteredCloudConnectors = useMemo(() => {
    if (!routeCatalog) return [];
    if (routeFilter !== 'all' && routeFilter !== 'cloud') return [];
    return routeCatalog.cloudConnectors
      .map(group => ({
        ...group,
        targets: group.targets.filter(target => {
          if (!searchQuery) return true;
          const hay = [
            target.label,
            target.providerModelId,
            group.label,
            group.provider,
            target.matchedConfigName,
            'cloud',
            '云端',
          ].filter(Boolean).join(' ').toLowerCase();
          return hay.includes(searchQuery);
        }),
      }))
      .filter(group => group.targets.length > 0);
  }, [routeCatalog, routeFilter, searchQuery]);

  const hasVisibleResults = filteredSaved.length > 0 || showLocalSection || filteredCloudConnectors.length > 0;

  async function pickConfigRef(targetRef: string) {
    setSwitchingModel(true);
    try {
      await onSelectModel(targetRef);
      setModelPopoverOpen(false);
    } finally {
      setSwitchingModel(false);
    }
  }

  async function pickRoute(route: NimiEnsureRouteInput) {
    if (!onSelectRoute) return;
    setSwitchingModel(true);
    try {
      await onSelectRoute(route);
      setModelPopoverOpen(false);
    } finally {
      setSwitchingModel(false);
    }
  }

  const PermIcon = permissionMode === 'strict' ? Shield : permissionMode === 'workspace-edit' ? ShieldCheck : Eye;
  const permLabel = permissionMode === 'strict'
    ? t('permission.strict')
    : permissionMode === 'workspace-edit'
      ? t('permission.workspaceEdit')
      : t('permission.planReadonly');

  const leadingControls = (
    <div className="harness-composer-controls">
      <Popover
        open={modelPopoverOpen}
        onOpenChange={open => {
          setModelPopoverOpen(open);
          if (open) {
            setModelSearch('');
            setRouteFilter('all');
            onRefreshRoutes?.();
          }
        }}
      >
        <PopoverTrigger asChild>
          <button type="button" className="harness-composer-pill" disabled={switchingModel}>
            <Sparkles size={12} aria-hidden="true" />
            <span className="harness-composer-pill__label">{modelLabel ?? t('model.choose')}</span>
            {reasoningChoices.length > 0 && reasoningEffort !== 'default' && (
              <span className="harness-composer-pill__tag">
                <Brain size={10} aria-hidden="true" />
                {effortLabel(reasoningEffort)}
              </span>
            )}
            <ChevronDown size={12} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="harness-popover harness-popover--models">
          {running && <p className="harness-muted harness-muted--xs">{t('model.stopBeforeSwitch')}</p>}

          <div className="harness-model-search">
            <Search size={13} aria-hidden="true" />
            <input
              type="text"
              value={modelSearch}
              placeholder={t('model.searchPlaceholder')}
              aria-label={t('model.searchPlaceholder')}
              onChange={event => setModelSearch(event.target.value)}
            />
            {modelSearch && (
              <button
                type="button"
                className="harness-icon-btn"
                aria-label="Clear"
                onClick={() => setModelSearch('')}
              >
                <X size={12} />
              </button>
            )}
          </div>

          {routeCatalog && (
            <div className="harness-model-tabs" role="tablist" aria-label={t('model.configuration')}>
              {([
                ['all', t('model.filter.all')],
                ['cloud', t('model.filter.cloud')],
                ['local', t('model.filter.local')],
                ['saved', t('model.filter.saved')],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={routeFilter === key}
                  className={`harness-model-tab ${routeFilter === key ? 'harness-model-tab--active' : ''}`}
                  onClick={() => setRouteFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="harness-model-scroll">
            {loadingRoutes && !routeCatalog && (
              <p className="harness-muted harness-muted--xs">{t('model.loadingRoutes')}</p>
            )}

            {filteredSaved.length > 0 && (
              <div className="harness-model-group">
                <div className="harness-popover__title">{t('model.group.saved')}</div>
                <div className="harness-popover__list">
                  {filteredSaved.map(row => {
                    const active = row.configRef === activeConfigRef;
                    const sub = row.routeKind === 'local'
                      ? `${t('model.badge.local')}${row.targetLabel ? ` · ${row.targetLabel}` : ''}`
                      : row.routeKind === 'cloud'
                        ? [row.connectorLabel ?? row.provider, row.targetLabel].filter(Boolean).join(' · ')
                        : undefined;
                    return (
                      <button
                        key={row.configRef}
                        type="button"
                        disabled={running || switchingModel}
                        className={`harness-popover__item ${active ? 'harness-popover__item--active' : ''}`}
                        onClick={() => void pickConfigRef(row.configRef)}
                      >
                        <span className="harness-model-item-main">
                          <span className="harness-model-item-name">{row.name}</span>
                          {sub && <span className="harness-model-item-sub">{sub}</span>}
                        </span>
                        {row.routeKind !== 'unset' && (
                          <span className={`harness-model-badge ${row.routeKind === 'local' ? 'harness-model-badge--local' : ''}`}>
                            {row.routeKind === 'local' ? t('model.badge.local') : t('model.badge.cloud')}
                          </span>
                        )}
                        {active && <Check size={14} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {showLocalSection && routeCatalog && (
              <div className="harness-model-group">
                <div className="harness-popover__title">{t('model.group.local')}</div>
                <div className="harness-popover__list">
                  {routeCatalog.local.available ? (
                    <button
                      type="button"
                      disabled={running || switchingModel}
                      className={`harness-popover__item ${routeCatalog.local.matchedConfigRef && routeCatalog.local.matchedConfigRef === activeConfigRef ? 'harness-popover__item--active' : ''}`}
                      onClick={() => void pickRoute({ route: 'local' })}
                    >
                      <span className="harness-popover__item-lead">
                        <Cpu size={13} aria-hidden="true" />
                        <span className="harness-model-item-name">{routeCatalog.local.label ?? t('model.badge.local')}</span>
                      </span>
                      <span className="harness-model-badge harness-model-badge--local">{t('model.badge.local')}</span>
                      {routeCatalog.local.matchedConfigRef === activeConfigRef && <Check size={14} aria-hidden="true" />}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="harness-popover__item"
                      onClick={() => {
                        setModelPopoverOpen(false);
                        if (onOpenHomeModels) onOpenHomeModels();
                        else onOpenModels();
                      }}
                    >
                      <span className="harness-popover__item-lead">
                        <Cpu size={13} aria-hidden="true" />
                        <span className="harness-model-item-name">{t('model.localUnconfigured')}</span>
                      </span>
                      <span className="harness-model-badge harness-model-badge--warn">{t('model.badge.notSet')}</span>
                      <ExternalLink size={12} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {filteredCloudConnectors.map(group => (
              <div key={group.connectorRef} className="harness-model-group">
                <div className="harness-popover__title">{t('model.group.cloud', { name: group.label })}</div>
                <div className="harness-popover__list">
                  {group.targets.map(target => {
                    const active = Boolean(target.matchedConfigRef && target.matchedConfigRef === activeConfigRef);
                    return (
                      <button
                        key={`${group.connectorRef}:${target.targetKey}`}
                        type="button"
                        disabled={running || switchingModel}
                        className={`harness-popover__item ${active ? 'harness-popover__item--active' : ''}`}
                        onClick={() => void pickRoute({
                          route: 'cloud',
                          connectorRef: target.connectorRef,
                          targetKey: target.targetKey,
                        })}
                      >
                        <span className="harness-popover__item-lead">
                          <Cloud size={12} aria-hidden="true" />
                          <span className="harness-model-item-name">{target.label}</span>
                        </span>
                        {target.matchedConfigName && (
                          <span className="harness-model-badge">{target.matchedConfigName}</span>
                        )}
                        {active && <Check size={14} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {!loadingRoutes && !hasVisibleResults && (
              <p className="harness-muted harness-muted--xs">{t('model.emptySearch')}</p>
            )}
          </div>

          {reasoningChoices.length > 0 && (
            <div className="harness-popover__section">
              <div className="harness-popover__title">{t('model.reasoning')}</div>
              <div className="harness-effort-grid">
                {reasoningChoices.map(choice => (
                  <button
                    key={choice.value}
                    type="button"
                    className={`harness-effort-btn ${reasoningEffort === choice.value ? 'harness-effort-btn--active' : ''}`}
                    onClick={() => void onSelectReasoningEffort(choice.value)}
                  >
                    {effortLabel(choice.value)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="harness-popover__footer">
            <Button size="sm" tone="ghost" fullWidth leadingIcon={<Settings size={13} />} onClick={() => { setModelPopoverOpen(false); onOpenModels(); }}>
              {t('model.openSettings')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Popover open={permPopoverOpen} onOpenChange={setPermPopoverOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={`harness-composer-pill harness-composer-pill--perm-${permissionMode}`}>
            <PermIcon size={12} aria-hidden="true" />
            <span>{permLabel}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="harness-popover harness-popover--wide">
          <div className="harness-popover__section">
            <div className="harness-popover__title">{t('permission.label')}</div>
            {([
              ['strict', Shield, t('permission.strict'), t('permission.strictDesc')],
              ['workspace-edit', ShieldCheck, t('permission.workspaceEdit'), t('permission.workspaceEditDesc')],
              ['plan-readonly', Eye, t('permission.planReadonly'), t('permission.planReadonlyDesc')],
            ] as const).map(([mode, ModeIcon, label, desc]) => (
              <button
                key={mode}
                type="button"
                className={`harness-popover__choice ${permissionMode === mode ? 'harness-popover__choice--active' : ''}`}
                onClick={() => { setPermPopoverOpen(false); void onSelectPermissionMode(mode); }}
              >
                <ModeIcon size={15} aria-hidden="true" />
                <div>
                  <strong>{label}</strong>
                  <p>{desc}</p>
                </div>
                {permissionMode === mode && <Check size={14} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {lastRequest && draft && !draft.text && !draft.files.length && (
        <button
          type="button"
          className="harness-composer-pill"
          onClick={() => {
            edit({ text: lastRequest });
            composer.current?.querySelector('textarea')?.focus({ preventScroll: true });
          }}
        >
          {t('composer.editLast')}
        </button>
      )}
    </div>
  );

  return (
    <div
      className="harness-composer-shell"
      ref={composer}
      onBlur={() => void flush().catch(showError)}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
      onDrop={event => { event.preventDefault(); void importFiles(Array.from(event.dataTransfer.files)); }}
    >
      {/* Active task / stopped / queued status bar */}
      {running && (
        <div className="harness-run-bar">
          <span className="harness-run-bar__status" role="status">
            <Loader2 size={14} className={hasDecisions || needsResume ? '' : 'harness-spin'} aria-hidden="true" />
            <span>
              {hasDecisions
                ? t('composer.waitingDecision')
                : needsResume
                  ? t('composer.pausedClosed')
                  : t('composer.working')}
            </span>
          </span>
          <div className="harness-run-bar__actions">
            {needsResume && !hasDecisions && (
              <Button size="sm" tone="secondary" leadingIcon={<Play size={13} />} onClick={onResume}>
                {t('composer.resume')}
              </Button>
            )}
            <Button size="sm" tone="secondary" leadingIcon={<Square size={12} />} onClick={onStop}>
              {t('composer.stop')}
            </Button>
          </div>
        </div>
      )}

      {stopped && !running && (
        <div className="harness-status-strip" role="status">{t('composer.stopped')}</div>
      )}

      {queued.length > 0 && (
        <details className="harness-queue-bar">
          <summary>{t('composer.queuedCount', { count: queued.length })}</summary>
          <ul>
            {queued.map(item => (
              <li key={item.id}>
                <span>{item.text}</span>
                <Button size="sm" tone="ghost" onClick={() => onWithdraw(item.id)}>
                  {t('composer.removeQueued')}
                </Button>
              </li>
            ))}
          </ul>
          <p className="harness-muted harness-muted--xs">
            {running ? t('composer.queuedRunningHint') : t('composer.queuedIdleHint')}
          </p>
        </details>
      )}

      <input
        hidden
        type="file"
        multiple
        aria-label={t('composer.attach')}
        ref={fileInput}
        onChange={event => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          void importFiles(files);
        }}
      />

      <div className="harness-composer-card">
        <ChatComposer<Material>
          layout="stacked"
          text={draft?.text ?? ''}
          attachments={draft?.files ?? []}
          placeholder={queue ? t('composer.placeholderQueue') : t('composer.placeholder')}
          attachLabel={t('composer.attach')}
          sendLabel={queue ? t('composer.queue') : t('composer.send')}
          leadingSlot={leadingControls}
          disabled={!draft || importing}
          submitDisabled={!canSend}
          onTextChange={text => edit({ text })}
          onAttachmentsChange={files => edit({ files: [...files] })}
          attachmentAdapter={{ openPicker: () => { fileInput.current?.click(); }, getKey: f => f.ref, getLabel: f => f.name }}
          attachmentsSlot={({ attachments, removeAttachment }) => (
            <div className="harness-draft-files" role="group" aria-label={t('composer.attachedFiles')}>
              {attachments.map((file, index) => (
                <div className="harness-draft-file" key={file.ref}>
                  <button
                    type="button"
                    className="harness-draft-file__open"
                    title={file.ref}
                    onClick={event => openFile(file.ref, event.currentTarget)}
                  >
                    <Paperclip size={12} aria-hidden="true" />
                    <span className="filename">{file.name}</span>
                  </button>
                  <button
                    type="button"
                    className="harness-draft-file__remove"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => removeAttachment(index)}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          adapter={{
            submit: async () => {
              const submitted = store.current(sessionId);
              if (!submitted || !canSend || importingNow.current) return;
              await flush();
              const refs = submitted.files.map(f => JSON.stringify(f.ref));
              const text = [submitted.text.trim(), ...(refs.length ? ['Attached workspace files:\n' + refs.join('\n')] : [])].filter(Boolean).join('\n\n');
              await window.nimiHarness.submit(sessionId, text, submitted.requestId, queue);
              if (store.current(sessionId)?.requestId === submitted.requestId) {
                update(emptyDraft());
                await flush();
              }
            },
          }}
          onSubmitError={showError}
        />
      </div>

      <div className="harness-composer-foot">
        {importing
          ? <span role="status">{t('composer.importing')}</span>
          : <span>{t('composer.hint')}</span>}
      </div>
    </div>
  );
}
