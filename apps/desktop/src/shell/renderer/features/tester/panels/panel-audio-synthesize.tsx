import React from 'react';
import { useTranslation } from 'react-i18next';
import { SelectField, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import type { CapabilityState, VoiceOption } from '../tester-types.js';
import { asString } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { DiagnosticsPanel, ErrorBox, RawJsonSection, RunButton } from '../tester-diagnostics.js';
import { createModRuntimeClient } from '@nimiplatform/sdk/mod';
import { buildTesterSpeechFailure, runTesterAudioSynthesize } from '../tester-speech-actions.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

type AudioSynthesizePanelProps = {
  state: CapabilityState;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

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

  const VOICE_NONE = '__none__';
  const voiceOptions = React.useMemo(() => [
    { value: VOICE_NONE, label: t('Tester.route.none') },
    ...voices.map((v) => ({ value: v.voiceId, label: `${v.name} [${v.lang}]` })),
  ], [voices, t]);

  const formatOptions = [
    { value: 'mp3', label: 'mp3' },
    { value: 'wav', label: 'wav' },
    { value: 'ogg', label: 'ogg' },
    { value: 'pcm', label: 'pcm' },
  ];

  return (
    <div data-testid={E2E_IDS.testerPanel('audio.synthesize')} className="flex flex-col gap-3">
      <div data-testid={E2E_IDS.testerInput('audio-synthesize-text')}>
        <TextareaField className="font-mono text-xs" textareaClassName="h-20" value={text} onChange={(event) => setText(event.target.value)} placeholder={t('Tester.audioSynthesize.textPlaceholder')} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--nimi-text-muted)]">{t('Tester.audioSynthesize.presetVoice')}</span>
          <SelectField options={voiceOptions} value={selectedVoiceId || VOICE_NONE} onValueChange={(v) => setSelectedVoiceId(v === VOICE_NONE ? '' : v)} />
        </div>
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--nimi-text-muted)]">{t('Tester.audioSynthesize.audioFormat')}</span>
          <SelectField options={formatOptions} value={audioFormat} onValueChange={setAudioFormat} />
        </div>
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--nimi-text-muted)]">{t('Tester.audioSynthesize.manualVoiceOverride')}</span>
        <TextField className="font-mono text-xs" value={manualVoiceId} onChange={(event) => setManualVoiceId(event.target.value)} placeholder={t('Tester.audioSynthesize.manualVoicePlaceholder')} />
      </div>
      <RunButton busy={state.busy} label={t('Tester.audioSynthesize.run')} onClick={() => { void handleRun(); }} />
      {state.error ? <ErrorBox message={state.error} /> : null}
      {audioOutput?.audioUri ? (
        <div>
          <audio controls className="w-full" src={audioOutput.audioUri} />
          <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">
            {audioOutput.mimeType || 'audio'} {'\u00B7'} {audioOutput.durationMs ? `${audioOutput.durationMs}ms` : t('Tester.audioSynthesize.durationUnknown')}
          </div>
        </div>
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
