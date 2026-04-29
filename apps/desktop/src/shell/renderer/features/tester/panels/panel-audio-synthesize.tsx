import React from 'react';
import { useTranslation } from 'react-i18next';
import { TextareaField } from '@nimiplatform/nimi-kit/ui';
import {
  AUDIO_SYNTHESIZE_RESPONSE_FORMAT_OPTIONS,
  type AudioSynthesizeParamsState,
} from '@nimiplatform/nimi-kit/features/model-config';
import type { SpeechVoiceReference } from '@nimiplatform/sdk/runtime';
import { VoiceAssetStatus, VoiceWorkflowType } from '@nimiplatform/sdk/runtime';
import type { CapabilityState, VoiceAssetSelection, VoiceOption } from '../tester-types.js';
import { asString } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { DiagnosticsPanel, ErrorBox, RawJsonSection } from '../tester-diagnostics.js';
import { createModRuntimeClient } from '@nimiplatform/sdk/mod';
import { buildTesterSpeechFailure, runTesterAudioSynthesize } from '../tester-speech-actions.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { listTesterVoiceAssets, type TesterVoiceAsset } from '../tester-voice-assets';

type AudioSynthesizePanelProps = {
  state: CapabilityState;
  params: AudioSynthesizeParamsState;
  onParamsChange: (next: AudioSynthesizeParamsState) => void;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
  voiceAssetRefreshRevision?: number;
  voiceComposer?: React.ReactNode;
  onUseVoiceAsset?: (asset: VoiceAssetSelection) => void;
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

type VoiceChoice = {
  key: string;
  label: string;
  group: 'preset' | 'asset';
  voiceRef: SpeechVoiceReference;
  asset?: VoiceAssetSelection;
};

function VoicePopover(props: {
  voiceChoices: VoiceChoice[];
  selectedVoiceKey: string;
  onSelectedVoiceKeyChange: (choice: VoiceChoice | null) => void;
  audioFormat: string;
  onAudioFormatChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const wrapperRef = useDismissable(open, () => setOpen(false));

  const presetChoices = props.voiceChoices.filter((choice) => choice.group === 'preset');
  const assetChoices = props.voiceChoices.filter((choice) => choice.group === 'asset');

  const formatOptions = AUDIO_SYNTHESIZE_RESPONSE_FORMAT_OPTIONS.map((item) => ({ value: item, label: item }));

  const triggerLabel = t('Tester.audioSynthesize.options', { defaultValue: 'Voice options' });
  const summaryVoice = props.selectedVoiceKey
    ? (props.voiceChoices.find((choice) => choice.key === props.selectedVoiceKey)?.label || props.selectedVoiceKey)
    : t('Tester.route.none');

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
                {t('Tester.audioSynthesize.voiceReference', { defaultValue: 'Voice' })}
              </div>
              <div className="max-h-52 overflow-y-auto rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-1">
                <button
                  type="button"
                  onClick={() => props.onSelectedVoiceKeyChange(null)}
                  className={`flex w-full items-center justify-between rounded-[var(--nimi-radius-sm)] px-2 py-1.5 text-left text-[11px] transition-colors ${
                    !props.selectedVoiceKey
                      ? 'bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
                      : 'text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-card)]'
                  }`}
                >
                  <span className="truncate">{t('Tester.route.none')}</span>
                </button>
                {assetChoices.length > 0 ? (
                  <div className="mt-1">
                    <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
                      {t('Tester.audioSynthesize.customVoiceAssets', { defaultValue: 'Custom voice assets' })}
                    </div>
                    {assetChoices.map((choice) => {
                      const active = props.selectedVoiceKey === choice.key;
                      return (
                        <button
                          key={choice.key}
                          type="button"
                          onClick={() => props.onSelectedVoiceKeyChange(choice)}
                          className={`flex w-full items-center justify-between rounded-[var(--nimi-radius-sm)] px-2 py-1.5 text-left text-[11px] transition-colors ${
                            active
                              ? 'bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
                              : 'text-[var(--nimi-text-primary)] hover:bg-[var(--nimi-surface-card)]'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {presetChoices.length > 0 ? (
                  <div className="mt-1">
                    <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
                      {t('Tester.audioSynthesize.presetVoices', { defaultValue: 'Preset voices' })}
                    </div>
                    {presetChoices.map((choice) => {
                      const active = props.selectedVoiceKey === choice.key;
                      return (
                        <button
                          key={choice.key}
                          type="button"
                          onClick={() => props.onSelectedVoiceKeyChange(choice)}
                          className={`flex w-full items-center justify-between rounded-[var(--nimi-radius-sm)] px-2 py-1.5 text-left text-[11px] transition-colors ${
                            active
                              ? 'bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
                              : 'text-[var(--nimi-text-primary)] hover:bg-[var(--nimi-surface-card)]'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
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

function optionalFiniteNumber(value: string): number | undefined {
  const text = asString(value);
  if (!text) return undefined;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function optionalPositiveInt(value: string): number | undefined {
  const numeric = optionalFiniteNumber(value);
  if (numeric === undefined || numeric <= 0) return undefined;
  return Math.round(numeric);
}

function voiceReferenceKey(value: SpeechVoiceReference | null | undefined): string {
  if (!value) return '';
  switch (value.kind) {
    case 'preset_voice_id':
      return `preset:${value.presetVoiceId}`;
    case 'voice_asset_id':
      return `asset:${value.voiceAssetId}`;
    case 'provider_voice_ref':
      return `provider:${value.providerVoiceRef}`;
  }
}

export function AudioSynthesizePanel(props: AudioSynthesizePanelProps) {
  const { t } = useTranslation();
  const { state, params, onParamsChange, onStateChange, voiceAssetRefreshRevision = 0, voiceComposer, onUseVoiceAsset } = props;
  const [text, setText] = React.useState('Hello, this is a test of text to speech synthesis.');
  const [voices, setVoices] = React.useState<VoiceOption[]>([]);
  const [voiceAssets, setVoiceAssets] = React.useState<Array<VoiceAssetSelection & { preferredName: string }>>([]);
  const [createVoiceOpen, setCreateVoiceOpen] = React.useState(false);
  const lastAutoVoiceBindingRef = React.useRef('');
  const configuredVoiceKey = voiceReferenceKey(params.voiceRef);
  const audioFormat = asString(params.responseFormat) || 'mp3';

  const updateParams = React.useCallback((nextPatch: Partial<AudioSynthesizeParamsState>) => {
    onParamsChange({ ...params, ...nextPatch });
  }, [onParamsChange, params]);

  React.useEffect(() => {
    const effectiveBinding = resolveEffectiveBinding(state.snapshot, state.binding);
    const bindingKey = [
      effectiveBinding?.source || '',
      effectiveBinding?.connectorId || '',
      effectiveBinding?.model || '',
      effectiveBinding?.modelId || '',
      effectiveBinding?.localModelId || '',
      effectiveBinding?.goRuntimeLocalModelId || '',
    ].join('|');
    if (!effectiveBinding) {
      setVoices([]);
      setVoiceAssets([]);
      lastAutoVoiceBindingRef.current = '';
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const modClient = createModRuntimeClient('core:runtime');
        const [result, assetResult] = await Promise.all([
          modClient.media.tts.listVoices({ binding: effectiveBinding }),
          listTesterVoiceAssets(modClient, {
            modelId: '',
            targetModelId: '',
            workflowType: VoiceWorkflowType.UNSPECIFIED,
            status: VoiceAssetStatus.ACTIVE,
            pageSize: 100,
            pageToken: '',
            connectorId: asString(effectiveBinding.connectorId),
          }),
        ]);
        if (cancelled) return;
        setVoices(result.voices);
        const assets = (assetResult.assets || [])
          .map((asset: TesterVoiceAsset) => ({
            voiceAssetId: asString(asset.voiceAssetId),
            preferredName: asString(asset.providerVoiceRef) || asString(asset.voiceAssetId),
            providerVoiceRef: asString(asset.providerVoiceRef),
            modelId: asString(asset.modelId),
            targetModelId: asString(asset.targetModelId),
          }))
          .filter((asset) => asset.voiceAssetId);
        setVoiceAssets(assets);
        const fallbackVoiceRef: SpeechVoiceReference | null = result.voices[0]?.voiceId
          ? { kind: 'preset_voice_id', presetVoiceId: result.voices[0].voiceId }
          : (assets[0]?.voiceAssetId ? { kind: 'voice_asset_id', voiceAssetId: assets[0].voiceAssetId } : null);
        if (!configuredVoiceKey && fallbackVoiceRef && lastAutoVoiceBindingRef.current !== bindingKey) {
          lastAutoVoiceBindingRef.current = bindingKey;
          updateParams({ voiceRef: fallbackVoiceRef });
        }
      } catch {
        if (cancelled) return;
        setVoices([]);
        setVoiceAssets([]);
      }
    })();
    return () => { cancelled = true; };
  }, [configuredVoiceKey, state.snapshot, state.binding, updateParams, voiceAssetRefreshRevision]);

  const voiceChoices = React.useMemo<VoiceChoice[]>(() => [
    ...voices.map((voice) => ({
      key: `preset:${voice.voiceId}`,
      label: `${voice.name} [${voice.lang}]`,
      group: 'preset' as const,
      voiceRef: { kind: 'preset_voice_id', presetVoiceId: voice.voiceId } as SpeechVoiceReference,
    })),
    ...voiceAssets.map((asset) => ({
      key: `asset:${asset.voiceAssetId}`,
      label: asset.preferredName,
      group: 'asset' as const,
      voiceRef: { kind: 'voice_asset_id', voiceAssetId: asset.voiceAssetId } as SpeechVoiceReference,
      asset,
    })),
  ], [voiceAssets, voices]);

  const handleRun = React.useCallback(async () => {
    if (!asString(text)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.audioSynthesize.inputEmpty') }));
      return;
    }
    const voiceRef = params.voiceRef || undefined;
    onStateChange((prev) => ({ ...prev, busy: true, error: '', diagnostics: makeEmptyDiagnostics() }));
    const t0 = Date.now();
    const binding = resolveEffectiveBinding(state.snapshot, state.binding) || undefined;
    const requestParams: Record<string, unknown> = {
      text,
      voiceRef,
      audioFormat,
      language: asString(params.languageHint) || undefined,
      speed: optionalFiniteNumber(params.speakingRate),
      volume: optionalFiniteNumber(params.volume),
      pitch: optionalFiniteNumber(params.pitchSemitones),
      timeoutMs: optionalPositiveInt(params.timeoutMs),
      ...(binding ? { binding } : {}),
    };
    try {
      const result = await runTesterAudioSynthesize({
        binding,
        text,
        voiceRef,
        audioFormat,
        language: asString(params.languageHint) || undefined,
        speed: optionalFiniteNumber(params.speakingRate),
        volume: optionalFiniteNumber(params.volume),
        pitch: optionalFiniteNumber(params.pitchSemitones),
        timeoutMs: optionalPositiveInt(params.timeoutMs),
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
  }, [audioFormat, onStateChange, params.languageHint, params.pitchSemitones, params.speakingRate, params.timeoutMs, params.voiceRef, params.volume, state.binding, state.snapshot, text, t]);

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
            voiceChoices={voiceChoices}
            selectedVoiceKey={configuredVoiceKey}
            onSelectedVoiceKeyChange={(choice) => {
              updateParams({ voiceRef: choice?.voiceRef || null });
              if (choice?.asset) {
                onUseVoiceAsset?.(choice.asset);
              }
            }}
            audioFormat={audioFormat}
            onAudioFormatChange={(next) => updateParams({ responseFormat: next })}
          />
          <div className="flex items-center gap-2">
            {voiceComposer ? (
              <button
                type="button"
                data-testid={E2E_IDS.testerInput('create-voice')}
                onClick={() => setCreateVoiceOpen((value) => !value)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${
                  createVoiceOpen
                    ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
                    : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-primary)]'
                }`}
              >
                <span>{t('Tester.voiceAsset.createVoice', { defaultValue: 'Create voice' })}</span>
                {CHEVRON_DOWN}
              </button>
            ) : null}
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
      </div>

      {createVoiceOpen && voiceComposer ? (
        <div className="rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-3">
          {voiceComposer}
        </div>
      ) : null}

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
