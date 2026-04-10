import React from 'react';
import { useTranslation } from 'react-i18next';
import { TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import type { CapabilityState } from '../tester-types.js';
import { asString, toPrettyJson } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { getRuntimeClient, resolveCallParams, bindingToRouteInfo } from '../tester-runtime.js';
import { DiagnosticsPanel, ErrorBox, InfoBox, RawJsonSection, RunButton } from '../tester-diagnostics.js';
import { useMediaAttachments, buildMultimodalInput, ImageAttachmentStrip } from '../tester-multimodal-input.js';

type TextGeneratePanelProps = {
  state: CapabilityState;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

export function TextGeneratePanel(props: TextGeneratePanelProps) {
  const { t } = useTranslation();
  const { state, onStateChange } = props;
  const [prompt, setPrompt] = React.useState('Hello! Tell me a short joke.');
  const [system, setSystem] = React.useState('');
  const [temperature, setTemperature] = React.useState('1');
  const [maxTokens, setMaxTokens] = React.useState('');
  const media = useMediaAttachments();

  const handleRun = React.useCallback(async () => {
    if (!asString(prompt)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.textGenerate.promptEmpty') }));
      return;
    }
    onStateChange((prev) => ({ ...prev, busy: true, busyLabel: t('Tester.textGenerate.preparingRoute'), error: '', diagnostics: makeEmptyDiagnostics() }));
    const t0 = Date.now();
    const binding = resolveEffectiveBinding(state.snapshot, state.binding) || undefined;
    const tempNum = temperature ? Number(temperature) : undefined;
    const maxTokNum = maxTokens ? Number(maxTokens) : undefined;
    const requestParams: Record<string, unknown> = {
      input: prompt,
      ...(system ? { system } : {}),
      ...(tempNum !== undefined ? { temperature: tempNum } : {}),
      ...(maxTokNum !== undefined ? { maxTokens: maxTokNum } : {}),
      ...(binding ? { binding } : {}),
    };
    try {
      const callParams = await resolveCallParams(binding);
      const routeInfo = bindingToRouteInfo(binding);
      onStateChange((prev) => ({
        ...prev,
        busy: true,
        busyLabel: binding?.source === 'local' ? t('Tester.textGenerate.warmingLocal') : t('Tester.diagnostics.running'),
      }));
      const input = buildMultimodalInput(prompt, media.attachments);
      const result = await getRuntimeClient().ai.text.generate({
        model: callParams.model,
        route: callParams.route,
        connectorId: callParams.connectorId,
        input,
        ...(system ? { system } : {}),
        ...(tempNum !== undefined ? { temperature: tempNum } : {}),
        ...(maxTokNum !== undefined ? { maxTokens: maxTokNum } : {}),
        metadata: callParams.metadata,
      });
      const elapsed = Date.now() - t0;
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        busyLabel: '',
        result: 'passed',
        output: asString(result.text) || t('Tester.textGenerate.emptyOutput'),
        rawResponse: toPrettyJson({ request: requestParams, response: result }),
        diagnostics: {
          requestParams,
          resolvedRoute: routeInfo,
          responseMetadata: {
            finishReason: result.finishReason,
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
      const baseMessage = error instanceof Error ? error.message : String(error || t('Tester.textGenerate.failed'));
      const details = (error as Record<string, unknown>)?.details as Record<string, unknown> | undefined;
      const providerMessage = details?.provider_message as string | undefined;
      const message = providerMessage ? `${baseMessage} [provider: ${providerMessage}]` : baseMessage;
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        busyLabel: '',
        result: 'failed',
        error: message,
        rawResponse: toPrettyJson({ request: requestParams, error: message }),
        diagnostics: { requestParams, resolvedRoute: bindingToRouteInfo(binding), responseMetadata: { elapsed } },
      }));
    }
  }, [prompt, system, temperature, maxTokens, state.snapshot, state.binding, onStateChange, t]);

  return (
    <div className="flex flex-col gap-3">
      <TextareaField
        className="font-mono text-xs"
        textareaClassName="h-20"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={t('Tester.textGenerate.promptPlaceholder')}
      />
      <ImageAttachmentStrip
        images={media.attachments}
        fileInputRef={media.fileInputRef}
        onAddFiles={media.addFiles}
        onRemove={media.removeAttachment}
        onOpenPicker={media.openFilePicker}
        disabled={state.busy}
      />
      <details className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-3 text-xs">
        <summary className="cursor-pointer font-semibold text-[var(--nimi-text-secondary)]">{t('Tester.textGenerate.advancedParams')}</summary>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--nimi-text-muted)]">{t('Tester.textGenerate.systemPrompt')}</span>
            <TextareaField
              className="font-mono text-xs"
              textareaClassName="h-16"
              value={system}
              onChange={(event) => setSystem(event.target.value)}
              placeholder={t('Tester.textGenerate.systemPromptPlaceholder')}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--nimi-text-muted)]">{t('Tester.textGenerate.temperature')}</span>
              <TextField
                className="font-mono text-xs"
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(event) => setTemperature(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--nimi-text-muted)]">{t('Tester.textGenerate.maxTokens')}</span>
              <TextField
                className="font-mono text-xs"
                type="number"
                min="1"
                value={maxTokens}
                onChange={(event) => setMaxTokens(event.target.value)}
                placeholder={t('Tester.textGenerate.maxTokensPlaceholder')}
              />
            </div>
          </div>
        </div>
      </details>
      <RunButton busy={state.busy} busyLabel={state.busyLabel} label={t('Tester.textGenerate.run')} onClick={() => { void handleRun(); }} />
      {state.error ? <ErrorBox message={state.error} /> : null}
      {state.busy && state.busyLabel === t('Tester.textGenerate.warmingLocal') ? (
        <InfoBox message={t('Tester.textGenerate.prewarmingNotice')} />
      ) : null}
      {state.output ? (
        <pre className="max-h-64 overflow-auto rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-canvas)] p-3 text-xs whitespace-pre-wrap">{asString(state.output)}</pre>
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
