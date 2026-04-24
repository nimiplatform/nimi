import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea, TextareaField } from '@nimiplatform/nimi-kit/ui';
import type { CapabilityState } from '../tester-types.js';
import { asString, toPrettyJson } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { getRuntimeClient, resolveCallParams, bindingToRouteInfo } from '../tester-runtime.js';
import { DiagnosticsPanel, ErrorBox, InfoBox, RawJsonSection } from '../tester-diagnostics.js';
import { useMediaAttachments, buildMultimodalInput, ImageAttachmentStrip } from '../tester-multimodal-input.js';
import { AdvancedParamsPopover } from '../tester-advanced-params.js';

type TextGeneratePanelProps = {
  state: CapabilityState;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

const PLUS_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const ARROW_UP_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

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
  }, [prompt, system, temperature, maxTokens, state.snapshot, state.binding, onStateChange, media.attachments, t]);

  const canSubmit = !state.busy && Boolean(prompt.trim());
  const attachLabel = t('Tester.multimodal.attachMedia', { defaultValue: 'Attach media' });
  const runLabel = t('Tester.textGenerate.run');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 pb-2 pt-3 transition-colors focus-within:border-[var(--nimi-field-focus)] focus-within:ring-[length:var(--nimi-focus-ring-width)] focus-within:ring-[var(--nimi-focus-ring-color)]">
        <TextareaField
          tone="quiet"
          className="p-0"
          textareaClassName="min-h-[3.5rem] resize-none px-0 py-0 font-mono text-xs"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t('Tester.textGenerate.promptPlaceholder')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSubmit) {
              event.preventDefault();
              void handleRun();
            }
          }}
        />
        {media.attachments.length > 0 ? (
          <div className="pt-2">
            <ImageAttachmentStrip
              images={media.attachments}
              fileInputRef={media.fileInputRef}
              onAddFiles={media.addFiles}
              onRemove={media.removeAttachment}
              onOpenPicker={media.openFilePicker}
              disabled={state.busy}
            />
          </div>
        ) : (
          <input
            ref={media.fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => media.addFiles(e.target.files)}
          />
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={media.openFilePicker}
            disabled={state.busy}
            aria-label={attachLabel}
            title={attachLabel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--nimi-border-subtle)] text-[var(--nimi-text-muted)] transition-colors hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {PLUS_ICON}
          </button>
          <div className="flex items-center gap-1.5">
            <AdvancedParamsPopover
              scope="textGenerate"
              system={system}
              onSystemChange={setSystem}
              temperature={temperature}
              onTemperatureChange={setTemperature}
              maxTokens={maxTokens}
              onMaxTokensChange={setMaxTokens}
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
      </div>

      {state.error ? <ErrorBox message={state.error} /> : null}
      {state.busy && state.busyLabel === t('Tester.textGenerate.warmingLocal') ? (
        <InfoBox message={t('Tester.textGenerate.prewarmingNotice')} />
      ) : null}
      {state.output ? (
        <ScrollArea className="max-h-64 rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-canvas)]">
          <pre className="whitespace-pre-wrap p-3 font-sans text-xs leading-relaxed text-[var(--nimi-text-primary)]">{asString(state.output)}</pre>
        </ScrollArea>
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
