import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CapabilityState } from '../tester-types.js';
import { asString, toPrettyJson } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { getRuntimeClient, resolveCallParams, bindingToRouteInfo } from '../tester-runtime.js';
import { DiagnosticsPanel, ErrorBox, InfoBox, RawJsonSection, RunButton } from '../tester-diagnostics.js';

type TextEmbedPanelProps = {
  state: CapabilityState;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

export function TextEmbedPanel(props: TextEmbedPanelProps) {
  const { t } = useTranslation();
  const { state, onStateChange } = props;
  const [text, setText] = React.useState(t('Tester.textEmbed.defaultText'));

  const handleRun = React.useCallback(async () => {
    if (!asString(text)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.textEmbed.inputEmpty') }));
      return;
    }
    onStateChange((prev) => ({ ...prev, busy: true, busyLabel: t('Tester.textEmbed.preparingRoute'), error: '', diagnostics: makeEmptyDiagnostics() }));
    const t0 = Date.now();
    const binding = resolveEffectiveBinding(state.snapshot, state.binding) || undefined;
    const requestParams: Record<string, unknown> = { input: text, ...(binding ? { binding } : {}) };
    try {
      const callParams = await resolveCallParams(binding);
      const routeInfo = bindingToRouteInfo(binding);
      onStateChange((prev) => ({
        ...prev,
        busy: true,
        busyLabel: binding?.source === 'local' ? t('Tester.textEmbed.warmingLocal') : t('Tester.textEmbed.generating'),
      }));
      const result = await getRuntimeClient().ai.embedding.generate({
        model: callParams.model,
        route: callParams.route,
        connectorId: callParams.connectorId,
        input: text,
        metadata: callParams.metadata,
      });
      const elapsed = Date.now() - t0;
      const vector = result.vectors[0] || [];
      const preview = vector.slice(0, 8).map((value: number) => value.toFixed(6)).join(', ');
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        busyLabel: undefined,
        result: 'passed',
        output: {
          dimensions: vector.length,
          vectors: result.vectors.length,
          preview: `[${preview}${vector.length > 8 ? ', \u2026' : ''}]`,
          values: vector,
          vectorText: `[${vector.join(', ')}]`,
        },
        rawResponse: toPrettyJson({ request: requestParams, response: result }),
        diagnostics: {
          requestParams,
          resolvedRoute: routeInfo,
          responseMetadata: {
            inputTokens: result.usage?.inputTokens,
            outputTokens: result.usage?.outputTokens,
            totalTokens: result.usage?.totalTokens,
            traceId: result.trace?.traceId,
            modelResolved: result.trace?.modelResolved,
            elapsed,
          },
        },
      }));
    } catch (error) {
      const elapsed = Date.now() - t0;
      const message = error instanceof Error ? error.message : String(error || t('Tester.textEmbed.failed'));
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        busyLabel: undefined,
        result: 'failed',
        error: message,
        rawResponse: toPrettyJson({ request: requestParams, error: message }),
        diagnostics: { requestParams, resolvedRoute: bindingToRouteInfo(binding), responseMetadata: { elapsed } },
      }));
    }
  }, [text, state.snapshot, state.binding, onStateChange, t]);

  const embedOutput = state.output as {
    dimensions?: number;
    vectors?: number;
    preview?: string;
    vectorText?: string;
  } | null;

  return (
    <div className="flex flex-col gap-3">
      <textarea
        className="h-28 w-full resize-y rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t('Tester.textEmbed.inputPlaceholder')}
      />
      <RunButton busy={state.busy} busyLabel={state.busyLabel} label={t('Tester.textEmbed.run')} onClick={() => { void handleRun(); }} />
      {state.error ? <ErrorBox message={state.error} /> : null}
      {embedOutput ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-xs">
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div><span className="text-gray-500">{t('Tester.textEmbed.vectors')}</span> <span className="font-mono">{embedOutput.vectors ?? 0}</span></div>
            <div><span className="text-gray-500">{t('Tester.textEmbed.dimensions')}</span> <span className="font-mono">{embedOutput.dimensions ?? 0}</span></div>
          </div>
          {embedOutput.preview ? <InfoBox message={`${t('Tester.textEmbed.previewPrefix')} ${embedOutput.preview}`} /> : null}
        </div>
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
