import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import type { CapabilityState } from '../tester-types.js';
import { asString } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { DiagnosticsPanel, ErrorBox, RawJsonSection } from '../tester-diagnostics.js';
import { buildTesterSpeechFailure, runTesterAudioTranscribe } from '../tester-speech-actions.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

type AudioTranscribePanelProps = {
  state: CapabilityState;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

const ARROW_UP_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

const PAPERCLIP_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const PLUS_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const SLIDERS_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="14" y2="6" />
    <line x1="18" y1="6" x2="20" y2="6" />
    <circle cx="16" cy="6" r="2" />
    <line x1="4" y1="12" x2="6" y2="12" />
    <line x1="10" y1="12" x2="20" y2="12" />
    <circle cx="8" cy="12" r="2" />
    <line x1="4" y1="18" x2="14" y2="18" />
    <line x1="18" y1="18" x2="20" y2="18" />
    <circle cx="16" cy="18" r="2" />
  </svg>
);

const CHEVRON_DOWN = (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const X_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

function useDismissable(open: boolean, onDismiss: () => void) {
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        onDismiss();
      }
    };
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onDismiss(); };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onDismiss]);
  return wrapperRef;
}

function TranscribeOptionsPopover(props: {
  language: string;
  onLanguageChange: (next: string) => void;
  mimeType: string;
  onMimeTypeChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const wrapperRef = useDismissable(open, () => setOpen(false));

  const triggerLabel = t('Tester.audioTranscribe.options', { defaultValue: 'Transcription options' });
  const summary: string[] = [];
  if (asString(props.language)) summary.push(props.language);
  if (asString(props.mimeType)) summary.push(props.mimeType);
  const summaryLabel = summary.length > 0 ? summary.join(' · ') : t('Tester.audioTranscribe.autoDetect', { defaultValue: 'Auto' });

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
          open
            ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
            : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-primary)]'
        }`}
      >
        <span className="text-[var(--nimi-text-muted)]">{SLIDERS_ICON}</span>
        <span className="max-w-[10rem] truncate">{summaryLabel}</span>
        {CHEVRON_DOWN}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={triggerLabel}
          className="absolute top-[calc(100%+0.5rem)] left-0 z-[var(--nimi-z-popover,40)] w-[280px] rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 shadow-[var(--nimi-elevation-floating)]"
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
                {t('Tester.audioTranscribe.language')}
              </div>
              <TextField
                className="font-mono text-xs"
                value={props.language}
                onChange={(event) => props.onLanguageChange(event.target.value)}
                placeholder={t('Tester.audioTranscribe.languagePlaceholder')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
                {t('Tester.audioTranscribe.mimeType')}
              </div>
              <TextField
                className="font-mono text-xs"
                value={props.mimeType}
                onChange={(event) => props.onMimeTypeChange(event.target.value)}
                placeholder={t('Tester.audioTranscribe.mimeTypePlaceholder')}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AudioTranscribePanel(props: AudioTranscribePanelProps) {
  const { t } = useTranslation();
  const { state, onStateChange } = props;
  const [audioUri, setAudioUri] = React.useState('');
  const [audioFile, setAudioFile] = React.useState<File | null>(null);
  const [language, setLanguage] = React.useState('');
  const [mimeType, setMimeType] = React.useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleRun = React.useCallback(async () => {
    if (!audioFile && !asString(audioUri)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.audioTranscribe.audioUrlEmpty') }));
      return;
    }
    onStateChange((prev) => ({ ...prev, busy: true, error: '', diagnostics: makeEmptyDiagnostics() }));
    const t0 = Date.now();
    const binding = resolveEffectiveBinding(state.snapshot, state.binding) || undefined;
    const inferredMimeType = asString(mimeType) || asString(audioFile?.type);
    const audio = audioFile
      ? { kind: 'bytes' as const, bytes: new Uint8Array(await audioFile.arrayBuffer()) }
      : { kind: 'url' as const, url: audioUri };
    const requestParams: Record<string, unknown> = {
      audio: audioFile
        ? { kind: 'bytes', bytes: `[${audioFile.size} bytes]`, fileName: audioFile.name }
        : { kind: 'url', url: audioUri },
      ...(language ? { language } : {}),
      ...(inferredMimeType ? { mimeType: inferredMimeType } : {}),
      ...(binding ? { binding } : {}),
    };
    try {
      const result = await runTesterAudioTranscribe({
        binding,
        audio,
        ...(language ? { language } : {}),
        ...(inferredMimeType ? { mimeType: inferredMimeType } : {}),
      });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: result.result,
        output: result.output || t('Tester.audioTranscribe.noTranscription'),
        rawResponse: result.rawResponse,
        diagnostics: result.diagnostics,
      }));
    } catch (error) {
      const failed = buildTesterSpeechFailure(error, {
        fallbackMessage: t('Tester.audioTranscribe.failed'),
        requestParams,
        binding,
        elapsed: Date.now() - t0,
      });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: failed.result,
        error: failed.error,
        rawResponse: failed.rawResponse,
        diagnostics: failed.diagnostics,
      }));
    }
  }, [audioFile, audioUri, language, mimeType, onStateChange, state.binding, state.snapshot, t]);

  const canSubmit = !state.busy && Boolean(audioFile || audioUri.trim());
  const runLabel = t('Tester.audioTranscribe.run');
  const attachLabel = t('Tester.audioTranscribe.attach', { defaultValue: 'Attach audio file' });

  return (
    <div data-testid={E2E_IDS.testerPanel('audio.transcribe')} className="flex flex-col gap-3">
      <div className="flex flex-col rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 pb-2 pt-3 transition-colors">
        <div data-testid={E2E_IDS.testerInput('audio-transcribe-url')}>
          <TextareaField
            tone="quiet"
            className="p-0 focus-within:border-transparent focus-within:ring-0"
            textareaClassName="min-h-[3.5rem] resize-none px-0 py-0 font-mono text-xs"
            value={audioUri}
            onChange={(event) => setAudioUri(event.target.value)}
            placeholder={t('Tester.audioTranscribe.audioUrlPlaceholder')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSubmit) {
                event.preventDefault();
                void handleRun();
              }
            }}
          />
        </div>
        {audioFile ? (
          <div className="mt-2 flex items-center gap-2 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] px-2 py-1.5 text-xs">
            <span className="text-[var(--nimi-text-muted)]">{PAPERCLIP_ICON}</span>
            <span className="min-w-0 flex-1 truncate text-[var(--nimi-text-primary)]" title={audioFile.name}>{audioFile.name}</span>
            <span className="shrink-0 text-[var(--nimi-text-muted)]">{Math.round(audioFile.size / 1024)} KB</span>
            <button
              type="button"
              onClick={() => {
                setAudioFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              aria-label={t('Tester.audioTranscribe.removeFile', { defaultValue: 'Remove file' })}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-surface-raised)] hover:text-[var(--nimi-accent-danger)]"
            >
              {X_ICON}
            </button>
          </div>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          data-testid={E2E_IDS.testerInput('audio-transcribe-file')}
          className="hidden"
          onChange={(event) => setAudioFile(event.target.files?.[0] || null)}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={state.busy}
              aria-label={attachLabel}
              title={attachLabel}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--nimi-border-subtle)] text-[var(--nimi-text-muted)] transition-colors hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {PLUS_ICON}
            </button>
            <TranscribeOptionsPopover
              language={language}
              onLanguageChange={setLanguage}
              mimeType={mimeType}
              onMimeTypeChange={setMimeType}
            />
          </div>
          <button
            type="button"
            onClick={() => { void handleRun(); }}
            disabled={!canSubmit}
            aria-label={runLabel}
            title={runLabel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] transition-colors hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {state.busy ? (
              <span className="inline-flex items-center gap-0.5">
                <span className="h-1 w-1 animate-bounce rounded-full bg-current opacity-80 [animation-delay:-0.2s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-current opacity-80 [animation-delay:-0.1s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-current opacity-80" />
              </span>
            ) : (
              ARROW_UP_ICON
            )}
          </button>
        </div>
      </div>

      {state.error ? <ErrorBox message={state.error} onDismiss={() => onStateChange((prev) => ({ ...prev, error: '' }))} /> : null}
      {state.output ? (
        <ScrollArea className="max-h-80 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]">
          <pre className="whitespace-pre-wrap break-words p-3 font-sans text-xs leading-relaxed text-[var(--nimi-text-primary)]">{asString(state.output)}</pre>
        </ScrollArea>
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
