import React from 'react';
import { useTranslation } from 'react-i18next';
import { Surface, TextareaField } from '@nimiplatform/nimi-kit/ui';
import type { CapabilityState } from '../tester-types.js';
import { asString, toPrettyJson } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { getRuntimeClient, resolveCallParams, bindingToRouteInfo } from '../tester-runtime.js';
import { DiagnosticsPanel, ErrorBox, InfoBox, RawJsonSection } from '../tester-diagnostics.js';

const ARROW_UP_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

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

  const canSubmit = !state.busy && Boolean(text.trim());
  const runLabel = t('Tester.textEmbed.run');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 pb-2 pt-3 transition-colors">
        <TextareaField
          tone="quiet"
          className="p-0 focus-within:border-transparent focus-within:ring-0"
          textareaClassName="min-h-[5rem] resize-none px-0 py-0 font-mono text-xs"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('Tester.textEmbed.inputPlaceholder')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSubmit) {
              event.preventDefault();
              void handleRun();
            }
          }}
        />
        <div className="mt-2 flex items-center justify-end gap-2">
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
      {state.error ? <ErrorBox message={state.error} /> : null}
      {embedOutput ? (
        <Surface tone="card" padding="sm" className="text-xs">
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div><span className="text-[var(--nimi-text-muted)]">{t('Tester.textEmbed.vectors')}</span> <span className="font-mono">{embedOutput.vectors ?? 0}</span></div>
            <div><span className="text-[var(--nimi-text-muted)]">{t('Tester.textEmbed.dimensions')}</span> <span className="font-mono">{embedOutput.dimensions ?? 0}</span></div>
          </div>
          {embedOutput.preview ? <InfoBox message={`${t('Tester.textEmbed.previewPrefix')} ${embedOutput.preview}`} /> : null}
        </Surface>
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
