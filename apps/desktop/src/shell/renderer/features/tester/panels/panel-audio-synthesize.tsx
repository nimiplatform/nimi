import React from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import type { CapabilityState, VoiceOption } from '../tester-types.js';
import { asString } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { DiagnosticsPanel, ErrorBox, RawJsonSection } from '../tester-diagnostics.js';
import { createModRuntimeClient } from '@nimiplatform/sdk/mod';
import { buildTesterSpeechFailure, runTesterAudioSynthesize } from '../tester-speech-actions.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

type AudioSynthesizePanelProps = {
  state: CapabilityState;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

const ARROW_UP_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
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

function VoicePopover(props: {
  voices: VoiceOption[];
  selectedVoiceId: string;
  onSelectedVoiceIdChange: (next: string) => void;
  manualVoiceId: string;
  onManualVoiceIdChange: (next: string) => void;
  audioFormat: string;
  onAudioFormatChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const wrapperRef = useDismissable(open, () => setOpen(false));

  const VOICE_NONE = '__none__';
  const voiceOptions = React.useMemo(() => [
    { value: VOICE_NONE, label: t('Tester.route.none') },
    ...props.voices.map((v) => ({ value: v.voiceId, label: `${v.name} [${v.lang}]` })),
  ], [props.voices, t]);

  const formatOptions = [
    { value: 'mp3', label: 'mp3' },
    { value: 'wav', label: 'wav' },
    { value: 'ogg', label: 'ogg' },
    { value: 'pcm', label: 'pcm' },
  ];

  const triggerLabel = t('Tester.audioSynthesize.options', { defaultValue: 'Voice options' });
  const summaryVoice = asString(props.manualVoiceId)
    || (props.selectedVoiceId
      ? (props.voices.find((v) => v.voiceId === props.selectedVoiceId)?.name || props.selectedVoiceId)
      : t('Tester.route.none'));

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
        <span className="max-w-[10rem] truncate">{summaryVoice}</span>
        <span className="text-[var(--nimi-text-muted)]">·</span>
        <span className="uppercase tracking-wide">{props.audioFormat}</span>
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
                {t('Tester.audioSynthesize.presetVoice')}
              </div>
              <SelectField
                options={voiceOptions}
                value={props.selectedVoiceId || VOICE_NONE}
                onValueChange={(v) => props.onSelectedVoiceIdChange(v === VOICE_NONE ? '' : v)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
                {t('Tester.audioSynthesize.manualVoiceOverride')}
              </div>
              <TextField
                className="font-mono text-xs"
                value={props.manualVoiceId}
                onChange={(event) => props.onManualVoiceIdChange(event.target.value)}
                placeholder={t('Tester.audioSynthesize.manualVoicePlaceholder')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
                {t('Tester.audioSynthesize.audioFormat')}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {formatOptions.map((opt) => {
                  const active = props.audioFormat === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => props.onAudioFormatChange(opt.value)}
                      className={`rounded-[var(--nimi-radius-sm)] border px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide transition-colors ${
                        active
                          ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
                          : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-border-strong)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AudioSynthesizePanel(props: AudioSynthesizePanelProps) {
  const { t } = useTranslation();
  const { state, onStateChange } = props;
  const [text, setText] = React.useState('Hello, this is a test of text to speech synthesis.');
  const [voices, setVoices] = React.useState<VoiceOption[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = React.useState('');
  const [manualVoiceId, setManualVoiceId] = React.useState('');
  const [audioFormat, setAudioFormat] = React.useState('mp3');

  React.useEffect(() => {
    const effectiveBinding = resolveEffectiveBinding(state.snapshot, state.binding);
    if (!effectiveBinding) {
      setVoices([]);
      setSelectedVoiceId('');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const modClient = createModRuntimeClient('core:runtime');
        const result = await modClient.media.tts.listVoices({ binding: effectiveBinding });
        if (cancelled) return;
        setVoices(result.voices);
        setSelectedVoiceId((prev) => {
          if (prev && result.voices.some((v) => v.voiceId === prev)) return prev;
          return result.voices[0]?.voiceId || '';
        });
      } catch {
        if (cancelled) return;
        setVoices([]);
        setSelectedVoiceId('');
      }
    })();
    return () => { cancelled = true; };
  }, [state.snapshot, state.binding]);

  const handleRun = React.useCallback(async () => {
    if (!asString(text)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.audioSynthesize.inputEmpty') }));
      return;
    }
    const voice = asString(manualVoiceId) || asString(selectedVoiceId);
    if (!voice) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.audioSynthesize.noVoiceSelected') }));
      return;
    }
    onStateChange((prev) => ({ ...prev, busy: true, error: '', diagnostics: makeEmptyDiagnostics() }));
    const t0 = Date.now();
    const binding = resolveEffectiveBinding(state.snapshot, state.binding) || undefined;
    const requestParams: Record<string, unknown> = { text, voice, audioFormat, ...(binding ? { binding } : {}) };
    try {
      const result = await runTesterAudioSynthesize({ binding, text, voice, audioFormat });
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
        fallbackMessage: t('Tester.audioSynthesize.failed'),
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
  }, [audioFormat, manualVoiceId, onStateChange, selectedVoiceId, state.binding, state.snapshot, text, t]);

  const audioOutput = state.output as { audioUri?: string; mimeType?: string; durationMs?: number } | null;
  const canSubmit = !state.busy && Boolean(text.trim());
  const runLabel = t('Tester.audioSynthesize.run');

  return (
    <div data-testid={E2E_IDS.testerPanel('audio.synthesize')} className="flex flex-col gap-3">
      <div className="flex flex-col rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 pb-2 pt-3 transition-colors">
        <div data-testid={E2E_IDS.testerInput('audio-synthesize-text')}>
          <TextareaField
            tone="quiet"
            className="p-0 focus-within:border-transparent focus-within:ring-0"
            textareaClassName="min-h-[3.5rem] resize-none px-0 py-0 font-mono text-xs"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('Tester.audioSynthesize.textPlaceholder')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSubmit) {
                event.preventDefault();
                void handleRun();
              }
            }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <VoicePopover
            voices={voices}
            selectedVoiceId={selectedVoiceId}
            onSelectedVoiceIdChange={setSelectedVoiceId}
            manualVoiceId={manualVoiceId}
            onManualVoiceIdChange={setManualVoiceId}
            audioFormat={audioFormat}
            onAudioFormatChange={setAudioFormat}
          />
          <button
            type="button"
            onClick={() => { void handleRun(); }}
            disabled={!canSubmit}
            aria-label={runLabel}
            title={runLabel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] transition-colors hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
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
      {audioOutput?.audioUri ? (
        <div className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3">
          <audio controls className="w-full" src={audioOutput.audioUri} />
          <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">
            {audioOutput.mimeType || 'audio'} {'·'} {audioOutput.durationMs ? `${audioOutput.durationMs}ms` : t('Tester.audioSynthesize.durationUnknown')}
          </div>
        </div>
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
