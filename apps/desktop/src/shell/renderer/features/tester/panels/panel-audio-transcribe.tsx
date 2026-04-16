import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea, TextField } from '@nimiplatform/nimi-kit/ui';
import type { CapabilityState } from '../tester-types.js';
import { asString } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { DiagnosticsPanel, ErrorBox, RawJsonSection, RunButton } from '../tester-diagnostics.js';
import { buildTesterSpeechFailure, runTesterAudioTranscribe } from '../tester-speech-actions.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

type AudioTranscribePanelProps = {
  state: CapabilityState;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

export function AudioTranscribePanel(props: AudioTranscribePanelProps) {
  const { t } = useTranslation();
  const { state, onStateChange } = props;
  const [audioUri, setAudioUri] = React.useState('');
  const [audioFile, setAudioFile] = React.useState<File | null>(null);
  const [language, setLanguage] = React.useState('');
  const [mimeType, setMimeType] = React.useState('');

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

  return (
    <div data-testid={E2E_IDS.testerPanel('audio.transcribe')} className="flex flex-col gap-3">
      <div data-testid={E2E_IDS.testerInput('audio-transcribe-url')}>
        <TextField className="font-mono text-xs" value={audioUri} onChange={(event) => setAudioUri(event.target.value)} placeholder={t('Tester.audioTranscribe.audioUrlPlaceholder')} />
      </div>
      <label className="flex flex-col gap-1 text-xs text-[var(--nimi-text-muted)]">
        <span>{t('Tester.audioTranscribe.audioFile', { defaultValue: 'Audio file' })}</span>
        <input
          type="file"
          accept="audio/*"
          data-testid={E2E_IDS.testerInput('audio-transcribe-file')}
          className="block rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border)] bg-[var(--nimi-surface-card)] px-2 py-1 text-xs text-[var(--nimi-text-primary)]"
          onChange={(event) => setAudioFile(event.target.files?.[0] || null)}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--nimi-text-muted)]">{t('Tester.audioTranscribe.language')}</span>
          <TextField className="font-mono text-xs" value={language} onChange={(event) => setLanguage(event.target.value)} placeholder={t('Tester.audioTranscribe.languagePlaceholder')} />
        </div>
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--nimi-text-muted)]">{t('Tester.audioTranscribe.mimeType')}</span>
          <TextField className="font-mono text-xs" value={mimeType} onChange={(event) => setMimeType(event.target.value)} placeholder={t('Tester.audioTranscribe.mimeTypePlaceholder')} />
        </div>
      </div>
      <RunButton busy={state.busy} label={t('Tester.audioTranscribe.run')} onClick={() => { void handleRun(); }} />
      {state.error ? <ErrorBox message={state.error} /> : null}
      {state.output ? (
        <ScrollArea className="max-h-48 rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-canvas)]">
          <pre className="p-2 text-xs">{asString(state.output)}</pre>
        </ScrollArea>
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
