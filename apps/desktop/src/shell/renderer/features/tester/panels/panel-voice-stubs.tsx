import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import type { CapabilityState } from '../tester-types.js';
import { asString } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { DiagnosticsPanel, ErrorBox, RawJsonSection } from '../tester-diagnostics.js';
import { buildTesterSpeechFailure, runTesterVoiceClone, runTesterVoiceDesign } from '../tester-speech-actions.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import {
  normalizeAudioFileForCloudTranscription,
  createRecordedAudioFile,
  normalizeRecordedAudioForCloudTranscription,
  TesterAudioRecordButton,
  useTesterAudioRecorder,
} from '../tester-audio-recording.js';

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

function RunButtonCircle(props: { busy: boolean; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] transition-colors hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {props.busy ? (
        <span className="inline-flex items-center gap-0.5">
          <span className="h-1 w-1 animate-bounce rounded-full bg-current opacity-80 [animation-delay:-0.2s]" />
          <span className="h-1 w-1 animate-bounce rounded-full bg-current opacity-80 [animation-delay:-0.1s]" />
          <span className="h-1 w-1 animate-bounce rounded-full bg-current opacity-80" />
        </span>
      ) : (
        ARROW_UP_ICON
      )}
    </button>
  );
}

type VoiceWorkflowOutput = {
  workflowStatus?: string;
  voiceAssetId?: string;
  providerVoiceRef?: string;
  status?: string;
  preferredName?: string;
} | null;

function WorkflowOutputCard({ output }: { output: VoiceWorkflowOutput }) {
  if (!output) return null;
  return (
    <ScrollArea className="max-h-48 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]">
      <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed text-[var(--nimi-text-primary)]">
        {[
          `workflowStatus: ${asString(output.workflowStatus) || 'unknown'}`,
          `voiceAssetId: ${asString(output.voiceAssetId) || 'n/a'}`,
          `providerVoiceRef: ${asString(output.providerVoiceRef) || 'n/a'}`,
          `assetStatus: ${asString(output.status) || 'n/a'}`,
          `preferredName: ${asString(output.preferredName) || 'n/a'}`,
        ].join('\n')}
      </pre>
    </ScrollArea>
  );
}

type VoiceClonePanelProps = {
  state: CapabilityState;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
  modeChip?: React.ReactNode;
};

function VoiceCloneOptionsPopover(props: {
  preferredName: string;
  onPreferredNameChange: (next: string) => void;
  referenceAudioUri: string;
  onReferenceAudioUriChange: (next: string) => void;
  referenceAudioMime: string;
  onReferenceAudioMimeChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const wrapperRef = useDismissable(open, () => setOpen(false));

  const triggerLabel = t('Tester.voiceClone.options', { defaultValue: 'Voice clone options' });
  const summary: string[] = [];
  if (asString(props.preferredName)) summary.push(props.preferredName);
  if (asString(props.referenceAudioMime)) summary.push(props.referenceAudioMime);
  const summaryLabel = summary.length > 0 ? summary.join(' · ') : t('Tester.voiceClone.optionsSummaryEmpty', { defaultValue: 'Options' });

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
          className="absolute top-[calc(100%+0.5rem)] left-0 z-[var(--nimi-z-popover,40)] w-[300px] rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 shadow-[var(--nimi-elevation-floating)]"
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
                {t('Tester.voiceClone.preferredName', { defaultValue: 'Preferred name' })}
              </div>
              <TextField
                className="font-mono text-xs"
                value={props.preferredName}
                onChange={(event) => props.onPreferredNameChange(event.target.value)}
                placeholder={t('Tester.voiceClone.preferredNamePlaceholder')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
                {t('Tester.voiceClone.refAudioUrl', { defaultValue: 'Reference audio URL' })}
              </div>
              <TextField
                className="font-mono text-xs"
                value={props.referenceAudioUri}
                onChange={(event) => props.onReferenceAudioUriChange(event.target.value)}
                placeholder={t('Tester.voiceClone.refAudioPlaceholder')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
                {t('Tester.voiceClone.refAudioMime', { defaultValue: 'Reference audio MIME' })}
              </div>
              <TextField
                className="font-mono text-xs"
                value={props.referenceAudioMime}
                onChange={(event) => props.onReferenceAudioMimeChange(event.target.value)}
                placeholder={t('Tester.voiceClone.referenceAudioMimePlaceholder')}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function VoiceClonePanel(props: VoiceClonePanelProps) {
  const { t } = useTranslation();
  const { state, onStateChange, modeChip } = props;
  const [prompt, setPrompt] = React.useState('Hello from the desktop tester voice clone workflow.');
  const [preferredName, setPreferredName] = React.useState('tester-clone');
  const [referenceAudioUri, setReferenceAudioUri] = React.useState('');
  const [referenceAudioFile, setReferenceAudioFile] = React.useState<File | null>(null);
  const [referenceAudioMime, setReferenceAudioMime] = React.useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const audioRecorder = useTesterAudioRecorder({
    onCaptured: async (result) => {
      const normalized = await normalizeRecordedAudioForCloudTranscription(result);
      setReferenceAudioFile(createRecordedAudioFile(normalized, 'voice-reference-recording'));
      setReferenceAudioUri('');
      setReferenceAudioMime(normalized.mimeType);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (message) => {
      onStateChange((prev) => ({ ...prev, error: message }));
    },
  });

  const handleRun = React.useCallback(async () => {
    if (!asString(prompt)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.voiceClone.promptEmpty', { defaultValue: 'Voice clone prompt is required.' }) }));
      return;
    }
    if (!referenceAudioFile && !asString(referenceAudioUri)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.voiceClone.referenceAudioRequired', { defaultValue: 'Reference audio URL or file is required.' }) }));
      return;
    }
    const binding = resolveEffectiveBinding(state.snapshot, state.binding) || undefined;
    const effectiveReferenceAudioFile = referenceAudioFile
      ? await normalizeAudioFileForCloudTranscription(referenceAudioFile, 'voice-reference-recording')
      : null;
    const convertedReferenceAudioFile = Boolean(effectiveReferenceAudioFile && effectiveReferenceAudioFile !== referenceAudioFile);
    if (effectiveReferenceAudioFile && convertedReferenceAudioFile) {
      setReferenceAudioFile(effectiveReferenceAudioFile);
      setReferenceAudioMime(effectiveReferenceAudioFile.type);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    const inferredMimeType = convertedReferenceAudioFile
      ? asString(effectiveReferenceAudioFile?.type)
      : asString(referenceAudioMime) || asString(effectiveReferenceAudioFile?.type);
    if (!inferredMimeType) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.voiceClone.referenceAudioMimeRequired', { defaultValue: 'Reference audio MIME type is required.' }) }));
      return;
    }
    onStateChange((prev) => ({ ...prev, busy: true, error: '', diagnostics: makeEmptyDiagnostics() }));
    const t0 = Date.now();
    const referenceAudio = effectiveReferenceAudioFile
      ? { kind: 'bytes' as const, bytes: new Uint8Array(await effectiveReferenceAudioFile.arrayBuffer()) }
      : { kind: 'url' as const, url: referenceAudioUri };
    const requestParams: Record<string, unknown> = {
      prompt,
      preferredName,
      referenceAudioMime: inferredMimeType,
      referenceAudio: effectiveReferenceAudioFile
        ? { kind: 'bytes', bytes: `[${effectiveReferenceAudioFile.size} bytes]`, fileName: effectiveReferenceAudioFile.name }
        : { kind: 'url', url: referenceAudioUri },
      ...(binding ? { binding } : {}),
    };
    try {
      const result = await runTesterVoiceClone({
        binding,
        prompt,
        preferredName,
        referenceAudio,
        referenceAudioMime: inferredMimeType,
      });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: result.result,
        output: result.output,
        rawResponse: result.rawResponse,
        diagnostics: result.diagnostics,
      }));
    } catch (error) {
      const failed = buildTesterSpeechFailure(error, {
        fallbackMessage: t('Tester.voiceClone.error', { defaultValue: 'Voice clone failed.' }),
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
  }, [onStateChange, preferredName, prompt, referenceAudioFile, referenceAudioMime, referenceAudioUri, state.binding, state.snapshot, t]);

  const output = state.output as VoiceWorkflowOutput;
  const canSubmit = !state.busy && Boolean(prompt.trim()) && Boolean(referenceAudioFile || referenceAudioUri.trim());
  const runLabel = t('Tester.voiceClone.run');
  const attachLabel = t('Tester.voiceClone.attach', { defaultValue: 'Attach reference audio' });

  return (
    <div data-testid={E2E_IDS.testerPanel('voice_workflow.tts_v2v')} className="flex flex-col gap-3">
      <div className="flex flex-col rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 pb-2 pt-3 transition-colors">
        <div data-testid={E2E_IDS.testerInput('voice-clone-prompt')}>
          <TextareaField
            tone="quiet"
            className="p-0 focus-within:border-transparent focus-within:ring-0"
            textareaClassName="min-h-[3.5rem] resize-none px-0 py-0 font-mono text-xs"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t('Tester.voiceClone.promptPlaceholder', { defaultValue: 'Speech text for the cloned voice.' })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSubmit) {
                event.preventDefault();
                void handleRun();
              }
            }}
          />
        </div>
        {referenceAudioFile ? (
          <div className="mt-2 flex items-center gap-2 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] px-2 py-1.5 text-xs">
            <span className="text-[var(--nimi-text-muted)]">{PAPERCLIP_ICON}</span>
            <span className="min-w-0 flex-1 truncate text-[var(--nimi-text-primary)]" title={referenceAudioFile.name}>{referenceAudioFile.name}</span>
            <span className="shrink-0 text-[var(--nimi-text-muted)]">{Math.round(referenceAudioFile.size / 1024)} KB</span>
            <button
              type="button"
              onClick={() => {
                setReferenceAudioFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              aria-label={t('Tester.voiceClone.removeFile', { defaultValue: 'Remove file' })}
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
          data-testid={E2E_IDS.testerInput('voice-clone-file')}
          className="hidden"
          onChange={(event) => setReferenceAudioFile(event.target.files?.[0] || null)}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {modeChip}
            <VoiceCloneOptionsPopover
              preferredName={preferredName}
              onPreferredNameChange={setPreferredName}
              referenceAudioUri={referenceAudioUri}
              onReferenceAudioUriChange={setReferenceAudioUri}
              referenceAudioMime={referenceAudioMime}
              onReferenceAudioMimeChange={setReferenceAudioMime}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <TesterAudioRecordButton
              recording={audioRecorder.recording}
              stopping={audioRecorder.stopping}
              disabled={state.busy}
              label={t('Tester.voiceClone.record', { defaultValue: 'Record reference audio' })}
              stopLabel={t('Tester.voiceClone.stopRecording', { defaultValue: 'Stop recording' })}
              onClick={audioRecorder.toggle}
              testId={E2E_IDS.testerInput('voice-clone-record')}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={state.busy}
              aria-label={attachLabel}
              title={attachLabel}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-transparent text-[var(--nimi-text-muted)] transition-colors hover:border-[var(--nimi-border-subtle)] hover:bg-[var(--nimi-surface-canvas)] hover:text-[var(--nimi-text-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {PAPERCLIP_ICON}
            </button>
            <RunButtonCircle busy={state.busy} disabled={!canSubmit} onClick={() => { void handleRun(); }} label={runLabel} />
          </div>
        </div>
      </div>

      {state.error ? <ErrorBox message={state.error} onDismiss={() => onStateChange((prev) => ({ ...prev, error: '' }))} /> : null}
      <WorkflowOutputCard output={output} />
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}

type VoiceDesignPanelProps = {
  state: CapabilityState;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
  modeChip?: React.ReactNode;
};

function VoiceDesignOptionsPopover(props: {
  language: string;
  onLanguageChange: (next: string) => void;
  preferredName: string;
  onPreferredNameChange: (next: string) => void;
  previewText: string;
  onPreviewTextChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const wrapperRef = useDismissable(open, () => setOpen(false));

  const triggerLabel = t('Tester.voiceDesign.options', { defaultValue: 'Voice design options' });
  const summary: string[] = [];
  if (asString(props.preferredName)) summary.push(props.preferredName);
  if (asString(props.language)) summary.push(props.language);
  const summaryLabel = summary.length > 0 ? summary.join(' · ') : t('Tester.voiceDesign.optionsSummaryEmpty', { defaultValue: 'Options' });

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
          className="absolute top-[calc(100%+0.5rem)] left-0 z-[var(--nimi-z-popover,40)] w-[320px] rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 shadow-[var(--nimi-elevation-floating)]"
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
                {t('Tester.voiceDesign.previewText', { defaultValue: 'Preview text' })}
              </div>
              <TextareaField
                textareaClassName="h-16 font-mono text-xs"
                value={props.previewText}
                onChange={(event) => props.onPreviewTextChange(event.target.value)}
                placeholder={t('Tester.voiceDesign.previewTextPlaceholder', { defaultValue: 'Preview text used to audition the designed voice.' })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
                {t('Tester.voiceDesign.language', { defaultValue: 'Language' })}
              </div>
              <TextField
                className="font-mono text-xs"
                value={props.language}
                onChange={(event) => props.onLanguageChange(event.target.value)}
                placeholder={t('Tester.voiceDesign.languagePlaceholder', { defaultValue: 'Language (optional)' })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
                {t('Tester.voiceDesign.preferredName', { defaultValue: 'Preferred name' })}
              </div>
              <TextField
                className="font-mono text-xs"
                value={props.preferredName}
                onChange={(event) => props.onPreferredNameChange(event.target.value)}
                placeholder={t('Tester.voiceDesign.preferredNamePlaceholder', { defaultValue: 'Preferred voice asset name' })}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function VoiceDesignPanel(props: VoiceDesignPanelProps) {
  const { t } = useTranslation();
  const { state, onStateChange, modeChip } = props;
  const [instructionText, setInstructionText] = React.useState('Warm, clear Mandarin speaking voice with steady pacing.');
  const [previewText, setPreviewText] = React.useState('Hello from the desktop tester voice design workflow.');
  const [language, setLanguage] = React.useState('');
  const [preferredName, setPreferredName] = React.useState('tester-design');

  const handleRun = React.useCallback(async () => {
    if (!asString(instructionText)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.voiceDesign.instructionEmpty', { defaultValue: 'Voice design instruction is required.' }) }));
      return;
    }
    const binding = resolveEffectiveBinding(state.snapshot, state.binding) || undefined;
    const requestParams: Record<string, unknown> = {
      instructionText,
      previewText: asString(previewText) || instructionText,
      language,
      preferredName,
      ...(binding ? { binding } : {}),
    };
    onStateChange((prev) => ({ ...prev, busy: true, error: '', diagnostics: makeEmptyDiagnostics() }));
    const t0 = Date.now();
    try {
      const result = await runTesterVoiceDesign({
        binding,
        instructionText,
        previewText: asString(previewText) || instructionText,
        language,
        preferredName,
      });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: result.result,
        output: result.output,
        rawResponse: result.rawResponse,
        diagnostics: result.diagnostics,
      }));
    } catch (error) {
      const failed = buildTesterSpeechFailure(error, {
        fallbackMessage: t('Tester.voiceDesign.error'),
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
  }, [instructionText, language, onStateChange, preferredName, previewText, state.binding, state.snapshot, t]);

  const output = state.output as VoiceWorkflowOutput;
  const canSubmit = !state.busy && Boolean(instructionText.trim());
  const runLabel = t('Tester.voiceDesign.run');

  return (
    <div data-testid={E2E_IDS.testerPanel('voice_workflow.tts_t2v')} className="flex flex-col gap-3">
      <div className="flex flex-col rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 pb-2 pt-3 transition-colors">
        <div data-testid={E2E_IDS.testerInput('voice-design-instruction')}>
          <TextareaField
            tone="quiet"
            className="p-0 focus-within:border-transparent focus-within:ring-0"
            textareaClassName="min-h-[3.5rem] resize-none px-0 py-0 font-mono text-xs"
            value={instructionText}
            onChange={(event) => setInstructionText(event.target.value)}
            placeholder={t('Tester.voiceDesign.instructionPlaceholder')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSubmit) {
                event.preventDefault();
                void handleRun();
              }
            }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {modeChip}
            <VoiceDesignOptionsPopover
              language={language}
              onLanguageChange={setLanguage}
              preferredName={preferredName}
              onPreferredNameChange={setPreferredName}
              previewText={previewText}
              onPreviewTextChange={setPreviewText}
            />
          </div>
          <RunButtonCircle busy={state.busy} disabled={!canSubmit} onClick={() => { void handleRun(); }} label={runLabel} />
        </div>
      </div>

      {state.error ? <ErrorBox message={state.error} onDismiss={() => onStateChange((prev) => ({ ...prev, error: '' }))} /> : null}
      <WorkflowOutputCard output={output} />
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}

/**
 * Combined voice-asset panel hosting both Clone and Design flows under a
 * single page. The mode is rendered as a chip in the active sub-panel's
 * bottom-left toolbar (mirroring the Image / Video pages). The two
 * underlying CapabilityStates remain separate so a mode switch never
 * destroys an in-flight or completed result for the other side.
 */
export type VoiceAssetMode = 'clone' | 'design';

export type VoiceAssetPanelProps = {
  mode: VoiceAssetMode;
  onModeChange: (mode: VoiceAssetMode) => void;
  cloneState: CapabilityState;
  onCloneStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
  designState: CapabilityState;
  onDesignStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

const VOICE_WAVE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10v4" />
    <path d="M7 6v12" />
    <path d="M12 3v18" />
    <path d="M17 6v12" />
    <path d="M21 10v4" />
  </svg>
);

function VoiceModeChip(props: { mode: VoiceAssetMode; onChange: (next: VoiceAssetMode) => void }) {
  const { t } = useTranslation();
  const { mode, onChange } = props;
  const [open, setOpen] = React.useState(false);
  const wrapperRef = useDismissable(open, () => setOpen(false));

  const cloneTitle = t('Tester.voiceAsset.modeClone', { defaultValue: 'Clone' });
  const designTitle = t('Tester.voiceAsset.modeDesign', { defaultValue: 'Design' });
  const cloneDesc = t('Tester.voiceAsset.modeCloneDesc', { defaultValue: 'Replicate a voice from a reference audio' });
  const designDesc = t('Tester.voiceAsset.modeDesignDesc', { defaultValue: 'Create a voice from a text description' });
  const shortLabel = mode === 'clone' ? cloneTitle : designTitle;

  const options: Array<{ value: VoiceAssetMode; title: string; desc: string }> = [
    { value: 'clone', title: cloneTitle, desc: cloneDesc },
    { value: 'design', title: designTitle, desc: designDesc },
  ];

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('Tester.voiceAsset.modeToggleLabel', { defaultValue: 'Voice mode' })}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--nimi-action-primary-bg)] transition-colors hover:border-[var(--nimi-border-strong)]"
      >
        <span>{VOICE_WAVE_ICON}</span>
        <span>{shortLabel}</span>
        {CHEVRON_DOWN}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={t('Tester.voiceAsset.modeToggleLabel', { defaultValue: 'Voice mode' })}
          className="absolute top-[calc(100%+0.5rem)] left-0 z-[var(--nimi-z-popover,40)] w-[260px] rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 shadow-[var(--nimi-elevation-floating)]"
        >
          <div className="flex flex-col gap-1">
            {options.map((opt) => {
              const active = opt.value === mode;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={`flex items-start justify-between gap-2 rounded-[var(--nimi-radius-sm)] px-2.5 py-2 text-left transition-colors ${
                    active
                      ? 'bg-[var(--nimi-action-primary-bg)]/10'
                      : 'hover:bg-[var(--nimi-surface-canvas)]'
                  }`}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className={`text-[12px] font-medium ${active ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)]'}`}>
                      {opt.title}
                    </span>
                    <span className="text-[10px] leading-snug text-[var(--nimi-text-muted)]">
                      {opt.desc}
                    </span>
                  </div>
                  {active ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-[var(--nimi-action-primary-bg)]">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function VoiceAssetPanel(props: VoiceAssetPanelProps) {
  const { mode, onModeChange, cloneState, onCloneStateChange, designState, onDesignStateChange } = props;
  const modeChip = <VoiceModeChip mode={mode} onChange={onModeChange} />;
  return (
    <div data-testid={E2E_IDS.testerPanel('voice_workflow.asset')}>
      {mode === 'clone' ? (
        <VoiceClonePanel state={cloneState} onStateChange={onCloneStateChange} modeChip={modeChip} />
      ) : (
        <VoiceDesignPanel state={designState} onStateChange={onDesignStateChange} modeChip={modeChip} />
      )}
    </div>
  );
}
