import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ScrollArea, TextareaField } from '@nimiplatform/nimi-kit/ui';
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

type Mode = 'sync' | 'stream';

const PAPERCLIP_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const ARROW_UP_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

const ZAP_ICON = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
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

function ResponseModeChip(props: { mode: Mode; onChange: (next: Mode) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const { mode, onChange, disabled } = props;
  const [open, setOpen] = React.useState(false);
  const wrapperRef = useDismissable(open, () => setOpen(false));

  const syncTitle = t('Tester.textGenerate.modeSync', { defaultValue: 'Sync' });
  const streamTitle = t('Tester.textGenerate.modeStream', { defaultValue: 'Stream' });
  const syncDesc = t('Tester.textGenerate.modeSyncDesc', { defaultValue: 'Wait for the full response, then show it' });
  const streamDesc = t('Tester.textGenerate.modeStreamDesc', { defaultValue: 'Show the response as it arrives, word by word' });
  const shortLabel = mode === 'sync' ? syncTitle : streamTitle;

  const options: Array<{ value: Mode; title: string; desc: string }> = [
    { value: 'sync', title: syncTitle, desc: syncDesc },
    { value: 'stream', title: streamTitle, desc: streamDesc },
  ];

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        aria-label={t('Tester.textGenerate.modeToggle', { defaultValue: 'Response mode' })}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--nimi-action-primary-bg)] transition-colors hover:border-[var(--nimi-border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span>{ZAP_ICON}</span>
        <span>{shortLabel}</span>
        {CHEVRON_DOWN}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={t('Tester.textGenerate.modeToggle', { defaultValue: 'Response mode' })}
          className="absolute top-[calc(100%+0.5rem)] left-0 z-[var(--nimi-z-popover,40)] w-[260px] rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 shadow-[var(--nimi-elevation-floating)]"
        >
          <div className="flex flex-col gap-1">
            {options.map((opt) => {
              const active = opt.value === mode;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={`flex items-start justify-between gap-2 rounded-[var(--nimi-radius-sm)] px-2.5 py-2 text-left transition-colors ${
                    active
                      ? 'bg-[var(--nimi-action-primary-bg)]/10'
                      : 'hover:bg-[var(--nimi-surface-canvas)]'
                  }`}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className={`text-[12px] font-medium ${active ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-primary)]'}`}>
                      {opt.title}
                    </span>
                    <span className="text-[10px] leading-snug text-[var(--nimi-text-muted)]">
                      {opt.desc}
                    </span>
                  </div>
                  {active ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-[var(--nimi-action-primary-bg)]">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TextGeneratePanel(props: TextGeneratePanelProps) {
  const { t } = useTranslation();
  const { state, onStateChange } = props;
  const [prompt, setPrompt] = React.useState('Hello! Tell me a short joke.');
  const [system, setSystem] = React.useState('');
  const [temperature, setTemperature] = React.useState('1');
  const [maxTokens, setMaxTokens] = React.useState('');
  const [mode, setMode] = React.useState<Mode>('sync');
  const media = useMediaAttachments();
  const abortRef = React.useRef<AbortController | null>(null);
  const outputRef = React.useRef('');
  const reasoningRef = React.useRef('');
  const [reasoningText, setReasoningText] = React.useState('');

  const handleStop = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const runSync = React.useCallback(async () => {
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

  const runStream = React.useCallback(async () => {
    handleStop();
    const controller = new AbortController();
    abortRef.current = controller;
    outputRef.current = '';
    reasoningRef.current = '';
    setReasoningText('');

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

      onStateChange((prev) => ({ ...prev, busyLabel: t('Tester.textStream.streaming', { defaultValue: 'Streaming...' }) }));

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
            setReasoningText(reasoningRef.current);
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
      const baseMessage = error instanceof Error ? error.message : String(error || t('Tester.textStream.failed', { defaultValue: 'Stream failed.' }));
      const details = (error as Record<string, unknown>)?.details as Record<string, unknown> | undefined;
      const providerMessage = details?.provider_message as string | undefined;
      const message = providerMessage ? `${baseMessage} [provider: ${providerMessage}]` : baseMessage;
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
  }, [prompt, system, temperature, maxTokens, state.snapshot, state.binding, onStateChange, handleStop, media.attachments, t]);

  const handleRun = React.useCallback(async () => {
    if (!asString(prompt)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.textGenerate.promptEmpty') }));
      return;
    }
    if (mode === 'stream') {
      await runStream();
    } else {
      await runSync();
    }
  }, [mode, prompt, runStream, runSync, onStateChange, t]);

  React.useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const canSubmit = !state.busy && Boolean(prompt.trim());
  const attachLabel = t('Tester.multimodal.attachMedia', { defaultValue: 'Attach media' });
  const runLabel = t('Tester.textGenerate.run');
  const stopLabel = t('Tester.textStream.stop', { defaultValue: 'Stop' });
  const outputText = asString(state.output);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 pb-2 pt-3 transition-colors">
        <TextareaField
          tone="quiet"
          className="p-0 focus-within:border-transparent focus-within:ring-0"
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
          <div className="flex items-center gap-1.5">
            <ResponseModeChip mode={mode} onChange={setMode} disabled={state.busy} />
            <AdvancedParamsPopover
              scope="textGenerate"
              system={system}
              onSystemChange={setSystem}
              temperature={temperature}
              onTemperatureChange={setTemperature}
              maxTokens={maxTokens}
              onMaxTokensChange={setMaxTokens}
            />
          </div>
          <div className="flex items-center gap-1.5">
            {mode === 'stream' && state.busy ? (
              <Button tone="danger" size="sm" onClick={handleStop}>
                {stopLabel}
              </Button>
            ) : null}
            <button
              type="button"
              onClick={media.openFilePicker}
              disabled={state.busy}
              aria-label={attachLabel}
              title={attachLabel}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-transparent text-[var(--nimi-text-muted)] transition-colors hover:border-[var(--nimi-border-subtle)] hover:bg-[var(--nimi-surface-canvas)] hover:text-[var(--nimi-text-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {PAPERCLIP_ICON}
            </button>
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
      {state.busy && (
        state.busyLabel === t('Tester.textGenerate.warmingLocal')
        || state.busyLabel === t('Tester.textStream.warmingLocal', { defaultValue: 'Warming local model...' })
      ) ? (
        <InfoBox message={t('Tester.textGenerate.prewarmingNotice')} />
      ) : null}
      {outputText ? (
        <ScrollArea className="max-h-80 rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-canvas)]">
          <pre className="whitespace-pre-wrap p-3 font-sans text-xs leading-relaxed text-[var(--nimi-text-primary)]">{outputText}</pre>
        </ScrollArea>
      ) : null}
      {mode === 'stream' && reasoningText && !state.busy ? (
        <details className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-[var(--nimi-text-secondary)]">
            {t('Tester.textStream.reasoning', { defaultValue: 'Reasoning trace' })}
          </summary>
          <ScrollArea className="mt-2 max-h-48">
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-[var(--nimi-text-secondary)]">{reasoningText}</pre>
          </ScrollArea>
        </details>
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
