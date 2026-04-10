import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import type { CapabilityState } from '../tester-types.js';
import { asString, toPrettyJson } from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { getRuntimeClient, resolveCallParams, bindingToRouteInfo } from '../tester-runtime.js';
import { DiagnosticsPanel, ErrorBox, InfoBox, RawJsonSection } from '../tester-diagnostics.js';
import { useMediaAttachments, buildMultimodalInput, ImageAttachmentStrip } from '../tester-multimodal-input.js';

type TextStreamPanelProps = {
  state: CapabilityState;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

export function TextStreamPanel(props: TextStreamPanelProps) {
  const { t } = useTranslation();
  const { state, onStateChange } = props;
  const [prompt, setPrompt] = React.useState('Hello! Tell me a short joke.');
  const [system, setSystem] = React.useState('');
  const [temperature, setTemperature] = React.useState('1');
  const [maxTokens, setMaxTokens] = React.useState('');
  const media = useMediaAttachments();
  const abortRef = React.useRef<AbortController | null>(null);
  const outputRef = React.useRef('');
  const reasoningRef = React.useRef('');

  const handleStop = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const handleRun = React.useCallback(async () => {
    if (!asString(prompt)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.textStream.promptEmpty', { defaultValue: 'Prompt is required.' }) }));
      return;
    }
    handleStop();
    const controller = new AbortController();
    abortRef.current = controller;
    outputRef.current = '';
    reasoningRef.current = '';

    onStateChange((prev) => ({
      ...prev,
      busy: true,
      busyLabel: t('Tester.textStream.preparingRoute', { defaultValue: 'Preparing route...' }),
      error: '',
      output: '',
      rawResponse: '',
      diagnostics: makeEmptyDiagnostics(),
    }));
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
        busyLabel: binding?.source === 'local'
          ? t('Tester.textStream.warmingLocal', { defaultValue: 'Warming local model...' })
          : t('Tester.textStream.streaming', { defaultValue: 'Streaming...' }),
      }));

      const input = buildMultimodalInput(prompt, media.attachments);
      const { stream } = await getRuntimeClient().ai.text.stream({
        model: callParams.model,
        route: callParams.route,
        connectorId: callParams.connectorId,
        input,
        ...(system ? { system } : {}),
        ...(tempNum !== undefined ? { temperature: tempNum } : {}),
        ...(maxTokNum !== undefined ? { maxTokens: maxTokNum } : {}),
        metadata: callParams.metadata,
        signal: controller.signal,
      });

      onStateChange((prev) => ({
        ...prev,
        busyLabel: t('Tester.textStream.streaming', { defaultValue: 'Streaming...' }),
      }));

      let finishReason: string | undefined;
      let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
      let trace: { traceId?: string; modelResolved?: string } | undefined;

      for await (const part of stream) {
        if (controller.signal.aborted) break;
        switch (part.type) {
          case 'delta':
            outputRef.current += part.text;
            onStateChange((prev) => ({ ...prev, output: outputRef.current }));
            break;
          case 'reasoning-delta':
            reasoningRef.current += part.text;
            break;
          case 'finish':
            finishReason = part.finishReason;
            usage = part.usage;
            trace = part.trace;
            break;
          case 'error':
            throw part.error;
        }
      }

      const elapsed = Date.now() - t0;
      const aborted = controller.signal.aborted;

      onStateChange((prev) => ({
        ...prev,
        busy: false,
        busyLabel: '',
        result: aborted ? 'failed' : 'passed',
        error: aborted ? t('Tester.textStream.aborted', { defaultValue: 'Stream aborted by user.' }) : '',
        output: outputRef.current || t('Tester.textStream.emptyOutput', { defaultValue: '(empty)' }),
        rawResponse: toPrettyJson({
          request: requestParams,
          response: {
            text: outputRef.current,
            ...(reasoningRef.current ? { reasoning: reasoningRef.current } : {}),
            finishReason,
            usage,
            trace,
            aborted,
          },
        }),
        diagnostics: {
          requestParams,
          resolvedRoute: routeInfo,
          responseMetadata: {
            finishReason,
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            totalTokens: usage?.totalTokens,
            traceId: trace?.traceId,
            modelResolved: trace?.modelResolved,
            elapsed,
          },
        },
      }));
    } catch (error) {
      const elapsed = Date.now() - t0;
      const message = error instanceof Error ? error.message : String(error || t('Tester.textStream.failed', { defaultValue: 'Stream failed.' }));
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        busyLabel: '',
        result: 'failed',
        error: message,
        output: outputRef.current || '',
        rawResponse: toPrettyJson({ request: requestParams, error: message, partialText: outputRef.current || undefined }),
        diagnostics: { requestParams, resolvedRoute: bindingToRouteInfo(binding), responseMetadata: { elapsed } },
      }));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [prompt, system, temperature, maxTokens, state.snapshot, state.binding, onStateChange, handleStop, t]);

  React.useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const outputText = asString(state.output);

  return (
    <div className="flex flex-col gap-3">
      <TextareaField
        className="font-mono text-xs"
        textareaClassName="h-20"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={t('Tester.textStream.promptPlaceholder', { defaultValue: 'Enter a prompt...' })}
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
        <summary className="cursor-pointer font-semibold text-[var(--nimi-text-secondary)]">
          {t('Tester.textStream.advancedParams', { defaultValue: 'Advanced Parameters' })}
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--nimi-text-muted)]">{t('Tester.textStream.systemPrompt', { defaultValue: 'System prompt' })}</span>
            <TextareaField
              className="font-mono text-xs"
              textareaClassName="h-16"
              value={system}
              onChange={(event) => setSystem(event.target.value)}
              placeholder={t('Tester.textStream.systemPromptPlaceholder', { defaultValue: 'Optional system prompt' })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--nimi-text-muted)]">{t('Tester.textStream.temperature', { defaultValue: 'Temperature' })}</span>
              <TextField
                className="font-mono text-xs"
                type="number" min="0" max="2" step="0.1"
                value={temperature}
                onChange={(event) => setTemperature(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <span className="text-[var(--nimi-text-muted)]">{t('Tester.textStream.maxTokens', { defaultValue: 'Max tokens' })}</span>
              <TextField
                className="font-mono text-xs"
                type="number" min="1"
                value={maxTokens}
                onChange={(event) => setMaxTokens(event.target.value)}
                placeholder={t('Tester.textStream.maxTokensPlaceholder', { defaultValue: 'Default' })}
              />
            </div>
          </div>
        </div>
      </details>

      <div className="flex items-center gap-2">
        <Button
          tone="primary"
          size="sm"
          disabled={state.busy && !abortRef.current}
          onClick={() => {
            if (state.busy) {
              handleStop();
            } else {
              void handleRun();
            }
          }}
        >
          {state.busy ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current opacity-70 [animation-delay:-0.2s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current opacity-70 [animation-delay:-0.1s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current opacity-70" />
              </span>
              {(state.busyLabel || t('Tester.textStream.streaming', { defaultValue: 'Streaming...' })).replace(/\.{3}$/, '')}
            </>
          ) : (
            t('Tester.textStream.run', { defaultValue: 'Generate' })
          )}
        </Button>
        {state.busy ? (
          <Button tone="danger" size="sm" onClick={handleStop}>
            {t('Tester.textStream.stop', { defaultValue: 'Stop' })}
          </Button>
        ) : null}
      </div>

      {state.error ? <ErrorBox message={state.error} /> : null}
      {state.busy && state.busyLabel?.includes('Warming') ? (
        <InfoBox message={t('Tester.textStream.prewarmingNotice', { defaultValue: 'Pre-warming local model. This may take a moment on first use.' })} />
      ) : null}

      {outputText ? (
        <div className="max-h-80 overflow-auto rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3">
          <pre className="whitespace-pre-wrap break-words text-xs text-[var(--nimi-text-primary)]">{outputText}</pre>
        </div>
      ) : null}
      {reasoningRef.current && !state.busy ? (
        <details className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-[var(--nimi-text-secondary)]">
            {t('Tester.textStream.reasoning', { defaultValue: 'Reasoning trace' })}
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-[var(--nimi-text-secondary)]">{reasoningRef.current}</pre>
        </details>
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
