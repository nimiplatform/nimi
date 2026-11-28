import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChatComposer } from '@nimiplatform/kit/features/chat';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@nimiplatform/kit/ui';
import { Brain, Check, ChevronDown, Eye, Loader2, Paperclip, Play, Settings, Shield, ShieldCheck, Sparkles, Square, X } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { emptyDraft, type Material, type SessionDrafts, type TaskDraft } from './session-drafts.js';
import { errorText, type PermissionMode, type ReasoningChoice } from './harness-types.js';
import { formatWorkspaceDisplayPath } from './workspace-files.js';

export function formatComposerError(error: unknown): string {
  return errorText(error).replace(/^Error invoking remote method '[^']+':\s*(?:[A-Za-z]*Error:\s*)?/, '').trim();
}
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
  reasoningChoices,
  reasoningEffort,
  permissionMode,
  report,
  openFile,
  focusOnOpen,
  focusToken,
  lastRequest,
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
  reasoningChoices: ReasoningChoice[];
  reasoningEffort: string;
  permissionMode: PermissionMode;
  report(message: string): void;
  focusOnOpen: boolean;
  focusToken?: number;
  lastRequest?: string;
  openFile(ref: string, opener: HTMLButtonElement): void;
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
  const showError = (error: unknown) => {
    if (mounted.current) report(formatComposerError(error));
  };

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

  const PermIcon = permissionMode === 'strict' ? Shield : permissionMode === 'workspace-edit' ? ShieldCheck : Eye;
  const permLabel = permissionMode === 'strict'
    ? t('permission.strict')
    : permissionMode === 'workspace-edit'
      ? t('permission.workspaceEdit')
      : t('permission.planReadonly');

  const leadingControls = (
    <div className="harness-composer-controls">
      <Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="harness-composer-pill">
            <Sparkles size={12} aria-hidden="true" />
            <span className="harness-composer-pill__label">{modelLabel ?? (canSend ? t('model.choose') : t('partner.noneReady'))}</span>
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
                    title={formatWorkspaceDisplayPath(file.ref)}
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
              try {
                await window.nimiHarness.submit(sessionId, text, submitted.requestId, queue);
              } catch (cause) {
                throw new Error(formatComposerError(cause));
              }
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
