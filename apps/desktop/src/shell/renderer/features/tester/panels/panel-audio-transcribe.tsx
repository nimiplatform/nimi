import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CapabilityState } from '../tester-types.js';
import { asString, toPrettyJson } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { getRuntimeClient, resolveCallParams, bindingToRouteInfo } from '../tester-runtime.js';
import { DiagnosticsPanel, ErrorBox, RawJsonSection, RunButton } from '../tester-diagnostics.js';

type AudioTranscribePanelProps = {
  state: CapabilityState;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

export function AudioTranscribePanel(props: AudioTranscribePanelProps) {
  const { t } = useTranslation();
  const { state, onStateChange } = props;
  const [audioUri, setAudioUri] = React.useState('');
  const [language, setLanguage] = React.useState('');
  const [mimeType, setMimeType] = React.useState('');

  const handleRun = React.useCallback(async () => {
    if (!asString(audioUri)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.audioTranscribe.audioUrlEmpty') }));
      return;
    }
    onStateChange((prev) => ({ ...prev, busy: true, error: '', diagnostics: makeEmptyDiagnostics() }));
    const t0 = Date.now();
    const binding = resolveEffectiveBinding(state.snapshot, state.binding) || undefined;
    const requestParams: Record<string, unknown> = {
      audio: { kind: 'url', url: audioUri },
      ...(language ? { language } : {}),
      ...(mimeType ? { mimeType } : {}),
      ...(binding ? { binding } : {}),
    };
    try {
      const callParams = await resolveCallParams(binding);
      const routeInfo = bindingToRouteInfo(binding);
      const result = await getRuntimeClient().media.stt.transcribe({
        model: callParams.model,
        route: callParams.route,
        connectorId: callParams.connectorId,
        audio: { kind: 'url', url: audioUri },
        ...(language ? { language } : {}),
        ...(mimeType ? { mimeType } : {}),
        metadata: callParams.metadata,
      });
      const elapsed = Date.now() - t0;
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'passed',
        output: result.text || t('Tester.audioTranscribe.noTranscription'),
        rawResponse: toPrettyJson({ request: requestParams, response: result }),
        diagnostics: {
          requestParams,
          resolvedRoute: routeInfo,
          responseMetadata: {
            jobId: (result.job as unknown as Record<string, unknown>)?.jobId as string | undefined,
            traceId: result.trace?.traceId,
            modelResolved: result.trace?.modelResolved,
            elapsed,
          },
        },
      }));
    } catch (error) {
      const elapsed = Date.now() - t0;
      const message = error instanceof Error ? error.message : String(error || t('Tester.audioTranscribe.failed'));
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'failed',
        error: message,
        rawResponse: toPrettyJson({ request: requestParams, error: message }),
        diagnostics: { requestParams, resolvedRoute: bindingToRouteInfo(binding), responseMetadata: { elapsed } },
      }));
    }
  }, [audioUri, language, mimeType, onStateChange, state.binding, state.snapshot, t]);

  return (
    <div className="flex flex-col gap-3">
      <input className="w-full rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs" value={audioUri} onChange={(event) => setAudioUri(event.target.value)} placeholder={t('Tester.audioTranscribe.audioUrlPlaceholder')} />
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-500">{t('Tester.audioTranscribe.language')}</span>
          <input className="rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs" value={language} onChange={(event) => setLanguage(event.target.value)} placeholder={t('Tester.audioTranscribe.languagePlaceholder')} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-500">{t('Tester.audioTranscribe.mimeType')}</span>
          <input className="rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs" value={mimeType} onChange={(event) => setMimeType(event.target.value)} placeholder={t('Tester.audioTranscribe.mimeTypePlaceholder')} />
        </label>
      </div>
      <RunButton busy={state.busy} label={t('Tester.audioTranscribe.run')} onClick={() => { void handleRun(); }} />
      {state.error ? <ErrorBox message={state.error} /> : null}
      {state.output ? (
        <pre className="max-h-48 overflow-auto rounded-md bg-gray-50 p-2 text-xs">{asString(state.output)}</pre>
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
