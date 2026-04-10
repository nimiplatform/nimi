import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CapabilityState, VoiceOption } from '../tester-types.js';
import { asString, stripArtifacts, toArtifactPreviewUri, toPrettyJson } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { getRuntimeClient, resolveCallParams, bindingToRouteInfo } from '../tester-runtime.js';
import { DiagnosticsPanel, ErrorBox, RawJsonSection, RunButton } from '../tester-diagnostics.js';
import { createModRuntimeClient } from '@nimiplatform/sdk/mod';

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
      const callParams = await resolveCallParams(binding);
      const routeInfo = bindingToRouteInfo(binding);
      const result = await getRuntimeClient().media.tts.synthesize({
        model: callParams.model,
        route: callParams.route,
        connectorId: callParams.connectorId,
        text,
        voice,
        audioFormat,
        metadata: callParams.metadata,
      });
      const elapsed = Date.now() - t0;
      const artifact = result.artifacts[0];
      const audioUri = toArtifactPreviewUri({ uri: artifact?.uri, bytes: artifact?.bytes, mimeType: artifact?.mimeType });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'passed',
        output: { audioUri, mimeType: asString(artifact?.mimeType), durationMs: Number(artifact?.durationMs || 0) },
        rawResponse: toPrettyJson({ request: requestParams, response: stripArtifacts(result) }),
        diagnostics: {
          requestParams,
          resolvedRoute: routeInfo,
          responseMetadata: {
            jobId: (result.job as unknown as Record<string, unknown>)?.jobId as string | undefined,
            artifactCount: result.artifacts.length,
            traceId: result.trace?.traceId,
            modelResolved: result.trace?.modelResolved,
            elapsed,
          },
        },
      }));
    } catch (error) {
      const elapsed = Date.now() - t0;
      const message = error instanceof Error ? error.message : String(error || t('Tester.audioSynthesize.failed'));
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'failed',
        error: message,
        rawResponse: toPrettyJson({ request: requestParams, error: message }),
        diagnostics: { requestParams, resolvedRoute: bindingToRouteInfo(binding), responseMetadata: { elapsed } },
      }));
    }
  }, [audioFormat, manualVoiceId, onStateChange, selectedVoiceId, state.binding, state.snapshot, text, t]);

  const audioOutput = state.output as { audioUri?: string; mimeType?: string; durationMs?: number } | null;

  return (
    <div className="flex flex-col gap-3">
      <textarea className="h-20 w-full resize-y rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs" value={text} onChange={(event) => setText(event.target.value)} placeholder={t('Tester.audioSynthesize.textPlaceholder')} />
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-500">{t('Tester.audioSynthesize.presetVoice')}</span>
          <select className="rounded-md border border-gray-300 bg-white px-2 py-1" value={selectedVoiceId} onChange={(event) => setSelectedVoiceId(event.target.value)}>
            <option value="">{t('Tester.route.none')}</option>
            {voices.map((voice) => (
              <option key={voice.voiceId} value={voice.voiceId}>
                {voice.name} [{voice.lang}]
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-500">{t('Tester.audioSynthesize.audioFormat')}</span>
          <select className="rounded-md border border-gray-300 bg-white px-2 py-1" value={audioFormat} onChange={(event) => setAudioFormat(event.target.value)}>
            <option value="mp3">mp3</option>
            <option value="wav">wav</option>
            <option value="ogg">ogg</option>
            <option value="pcm">pcm</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-gray-500">{t('Tester.audioSynthesize.manualVoiceOverride')}</span>
        <input className="rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs" value={manualVoiceId} onChange={(event) => setManualVoiceId(event.target.value)} placeholder={t('Tester.audioSynthesize.manualVoicePlaceholder')} />
      </label>
      <RunButton busy={state.busy} label={t('Tester.audioSynthesize.run')} onClick={() => { void handleRun(); }} />
      {state.error ? <ErrorBox message={state.error} /> : null}
      {audioOutput?.audioUri ? (
        <div>
          <audio controls className="w-full" src={audioOutput.audioUri} />
          <div className="mt-1 text-xs text-gray-500">
            {audioOutput.mimeType || 'audio'} {'\u00B7'} {audioOutput.durationMs ? `${audioOutput.durationMs}ms` : t('Tester.audioSynthesize.durationUnknown')}
          </div>
        </div>
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
