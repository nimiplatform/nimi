import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, TextField } from '@nimiplatform/nimi-kit/ui';
import {
  type CapabilityState,
  type ImageGenerationRecord,
  type ImageWorkflowDraftState,
} from '../tester-types.js';
import {
  asString,
  buildAsyncImageJobOutcome,
  isTerminalScenarioJobStatus,
  loadImageHistory,
  saveImageHistory,
  scenarioJobEventLabel,
  scenarioJobStatusLabel,
  stripArtifacts,
  toArtifactPreviewUri,
  toPrettyJson,
} from '../tester-utils.js';
import { resolveEffectiveBinding, resolveImageResponseFormat } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { bindingToRouteInfo } from '../tester-runtime.js';
import { DiagnosticsPanel, ErrorBox, RawJsonSection } from '../tester-diagnostics.js';
import { createModRuntimeClient, type ModRuntimeBoundImageGenerateInput } from '@nimiplatform/sdk/mod';
import { ImageAdvancedParamsPopover } from './panel-image-generate-advanced.js';
import {
  buildProfileOverrides,
  buildWorkflowExtensions,
  formatScenarioJobProgress,
  shouldUseLocalImageWorkflowExtensions,
} from './panel-image-generate-model.js';

type ImageGeneratePanelProps = {
  mode?: 'generate' | 'job';
  state: CapabilityState;
  draft: ImageWorkflowDraftState;
  onDraftChange: React.Dispatch<React.SetStateAction<ImageWorkflowDraftState>>;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};
import { ARROW_UP_ICON, GenerationPrefsPopover, OutputGallery } from './panel-image-generate-components.js';

export function ImageGeneratePanel(props: ImageGeneratePanelProps) {
  const { t } = useTranslation();
  const { mode = 'generate', state, draft, onDraftChange, onStateChange } = props;
  const [watchPopoverOpen, setWatchPopoverOpen] = React.useState(false);
  const watchWrapperRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!watchPopoverOpen) return;
    const handlePointer = (event: MouseEvent) => {
      if (watchWrapperRef.current && !watchWrapperRef.current.contains(event.target as Node)) {
        setWatchPopoverOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setWatchPopoverOpen(false); };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [watchPopoverOpen]);
  const [watchJobId, setWatchJobId] = React.useState('');
  const [jobTimeline, setJobTimeline] = React.useState<Array<Record<string, unknown>>>([]);
  const watchSequenceRef = React.useRef(0);
  const [history, setHistory] = React.useState<ImageGenerationRecord[]>([]);

  React.useEffect(() => {
    void loadImageHistory().then(setHistory);
  }, []);

  const appendHistory = React.useCallback((record: ImageGenerationRecord) => {
    setHistory((prev) => {
      const next = [record, ...prev].slice(0, 20);
      void saveImageHistory(next);
      return next;
    });
  }, []);

  const deleteHistoryRecord = React.useCallback((id: string) => {
    setHistory((prev) => {
      const next = prev.filter((r) => r.id !== id);
      void saveImageHistory(next);
      return next;
    });
  }, []);

  const clearHistory = React.useCallback(() => {
    setHistory([]);
    void saveImageHistory([]);
  }, []);

  const effectiveBinding = React.useMemo(() => resolveEffectiveBinding(state.snapshot, state.binding), [state.snapshot, state.binding]);
  const usesLocalImageWorkflow = shouldUseLocalImageWorkflowExtensions(effectiveBinding);

  const updateDraft = React.useCallback((updater: Partial<ImageWorkflowDraftState> | ((prev: ImageWorkflowDraftState) => ImageWorkflowDraftState)) => {
    onDraftChange((prev) => {
      if (typeof updater === 'function') return updater(prev);
      return { ...prev, ...updater };
    });
  }, [onDraftChange]);

  const buildRequestContext = React.useCallback(() => {
    if (!asString(draft.prompt)) {
      return { error: 'Prompt is required.' };
    }
    const profileOverridesResult = buildProfileOverrides({
      step: draft.step, cfgScale: draft.cfgScale, sampler: draft.sampler,
      scheduler: draft.scheduler, optionsText: draft.optionsText, rawJsonText: draft.rawProfileOverridesText,
    });
    if (profileOverridesResult.error) {
      return { error: profileOverridesResult.error };
    }
    const binding = effectiveBinding || undefined;
    const nNum = Math.max(1, Number(draft.n) || 1);
    let extensions: Record<string, unknown> | undefined;
    if (usesLocalImageWorkflow) {
      const mainLocalAssetId = asString(binding?.goRuntimeLocalModelId || binding?.localModelId);
      const mainAssetId = asString(binding?.modelId || binding?.model);
      const localWorkflow = buildWorkflowExtensions({
        draft,
        profileOverrides: profileOverridesResult.overrides,
        mainLocalAssetId,
        mainAssetId,
      });
      if (localWorkflow.error) return { error: localWorkflow.error };
      extensions = localWorkflow.extensions;
    }
    const requestParams: Record<string, unknown> = {
      prompt: draft.prompt,
      ...(draft.negativePrompt ? { negativePrompt: draft.negativePrompt } : {}),
      n: nNum,
      ...(draft.size ? { size: draft.size } : {}),
      ...(draft.seed ? { seed: Number(draft.seed) || undefined } : {}),
      ...(draft.timeoutMs ? { timeoutMs: Number(draft.timeoutMs) || undefined } : {}),
      responseFormat: resolveImageResponseFormat(draft.responseFormatMode),
      ...(extensions ? { extensions } : {}),
      ...(binding ? { binding } : {}),
    };
    return { error: '', binding, requestParams };
  }, [draft, effectiveBinding, usesLocalImageWorkflow]);

  const finalizeAsyncImageJob = React.useCallback(async (input: {
    jobId: string;
    requestParams: Record<string, unknown> | null;
    routeInfo: Record<string, unknown> | null;
    job?: Record<string, unknown> | null;
    elapsed: number;
  }) => {
    let artifactFetchError = '';
    let artifactsResponse: { artifacts: Array<{ uri?: string; bytes?: Uint8Array; mimeType?: string }>; traceId?: string } = { artifacts: [] };
    try {
      const modClient = createModRuntimeClient('core:runtime');
      const response = await modClient.media.jobs.getArtifacts(input.jobId);
      artifactsResponse = {
        artifacts: Array.isArray(response.artifacts) ? response.artifacts : [],
        traceId: response.traceId,
      };
    } catch (error) {
      artifactFetchError = error instanceof Error ? error.message : String(error || 'Failed to fetch image job artifacts.');
    }
    const uris = (artifactsResponse.artifacts || [])
      .map((artifact) => toArtifactPreviewUri({ uri: artifact.uri, bytes: artifact.bytes, mimeType: artifact.mimeType, defaultMimeType: 'image/png' }))
      .filter(Boolean);
    const jobRecord = input.job || {};
    const outcome = buildAsyncImageJobOutcome({ status: jobRecord.status, reasonDetail: jobRecord.reasonDetail, artifactFetchError });
    const rawResponse = toPrettyJson({
      request: input.requestParams,
      jobId: input.jobId,
      job: input.job,
      events: jobTimeline,
      artifacts: stripArtifacts({ artifacts: artifactsResponse.artifacts }),
      previewUris: uris,
    });
    onStateChange((prev) => ({
      ...prev,
      busy: false,
      busyLabel: '',
      result: outcome.result,
      error: outcome.error,
      output: uris,
      rawResponse,
      diagnostics: {
        requestParams: input.requestParams,
        resolvedRoute: input.routeInfo as any,
        responseMetadata: {
          jobId: input.jobId,
          artifactCount: artifactsResponse.artifacts.length,
          traceId: asString(jobRecord.traceId || artifactsResponse.traceId) || undefined,
          elapsed: input.elapsed,
        },
      },
    }));
    const reqParams = input.requestParams || {};
    appendHistory({
      id: `img-${Date.now().toString(36)}`,
      timestamp: Date.now(),
      prompt: asString(reqParams.prompt),
      negativePrompt: asString(reqParams.negativePrompt),
      size: asString(reqParams.size),
      result: outcome.result === 'passed' ? 'passed' : 'failed',
      error: outcome.error || undefined,
      imageUris: uris,
      rawResponse,
      elapsed: input.elapsed,
    });
  }, [appendHistory, jobTimeline, onStateChange]);

  const watchAsyncImageJob = React.useCallback(async (input: {
    jobId: string;
    requestParams: Record<string, unknown> | null;
    routeInfo: Record<string, unknown> | null;
    initialJob?: Record<string, unknown> | null;
  }) => {
    const watchToken = ++watchSequenceRef.current;
    const startedAt = Date.now();
    setWatchJobId(input.jobId);
    setJobTimeline([]);
    const pushJobEvent = (label: string, job: Record<string, unknown> | null | undefined, sequence?: unknown) => {
      const normalizedJob = job || {};
      const progressLabel = formatScenarioJobProgress(normalizedJob);
      setJobTimeline((prev) => [...prev, {
        sequence: sequence ?? prev.length + 1,
        label,
        status: scenarioJobStatusLabel(normalizedJob.status),
        progressLabel: progressLabel || undefined,
        reasonDetail: asString(normalizedJob.reasonDetail) || undefined,
      }]);
      onStateChange((prev) => ({
        ...prev,
        busyLabel: progressLabel ? `Watching job... ${progressLabel}` : 'Watching job...',
      }));
    };
    onStateChange((prev) => ({ ...prev, busy: true, busyLabel: 'Watching job...', error: '', output: [], diagnostics: { requestParams: input.requestParams, resolvedRoute: input.routeInfo as any, responseMetadata: { jobId: input.jobId } } }));
    const modClient = createModRuntimeClient('core:runtime');
    let currentJob = input.initialJob || await modClient.media.jobs.get(input.jobId) as unknown as Record<string, unknown>;
    if (watchToken !== watchSequenceRef.current) return;
    pushJobEvent('submitted', currentJob);
    if (isTerminalScenarioJobStatus(currentJob.status)) {
      await finalizeAsyncImageJob({ jobId: input.jobId, requestParams: input.requestParams, routeInfo: input.routeInfo, job: currentJob, elapsed: Date.now() - startedAt });
      return;
    }
    const stream = await modClient.media.jobs.subscribe(input.jobId);
    for await (const event of stream) {
      if (watchToken !== watchSequenceRef.current) return;
      currentJob = (event.job as unknown as Record<string, unknown>) || currentJob;
      pushJobEvent(scenarioJobEventLabel(event.eventType), currentJob, event.sequence);
      if (isTerminalScenarioJobStatus(currentJob.status)) {
        await finalizeAsyncImageJob({ jobId: input.jobId, requestParams: input.requestParams, routeInfo: input.routeInfo, job: currentJob, elapsed: Date.now() - startedAt });
        return;
      }
    }
    if (watchToken !== watchSequenceRef.current) return;
    currentJob = await modClient.media.jobs.get(input.jobId) as unknown as Record<string, unknown>;
    await finalizeAsyncImageJob({ jobId: input.jobId, requestParams: input.requestParams, routeInfo: input.routeInfo, job: currentJob, elapsed: Date.now() - startedAt });
  }, [finalizeAsyncImageJob, onStateChange]);

  const handleRun = React.useCallback(async () => {
    const requestContext = buildRequestContext();
    if (requestContext.error) {
      onStateChange((prev) => ({ ...prev, error: requestContext.error }));
      return;
    }
    if (!requestContext.requestParams) {
      onStateChange((prev) => ({ ...prev, error: 'Image request params empty.' }));
      return;
    }
    onStateChange((prev) => ({ ...prev, busy: true, error: '', diagnostics: makeEmptyDiagnostics() }));
    const binding = requestContext.binding;
    const requestParams = requestContext.requestParams;
    try {
      const routeInfo = bindingToRouteInfo(binding);
      const modClient = createModRuntimeClient('core:runtime');
      const job = await modClient.media.jobs.submit({ modal: 'image', input: requestParams as unknown as ModRuntimeBoundImageGenerateInput });
      await watchAsyncImageJob({
        jobId: asString((job as unknown as Record<string, unknown>)?.jobId),
        requestParams,
        routeInfo,
        initialJob: job as unknown as Record<string, unknown>,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Image generation failed.');
      const rawResponse = toPrettyJson({ request: requestParams, error: message });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'failed',
        error: message,
        output: [],
        rawResponse,
        diagnostics: { requestParams, resolvedRoute: bindingToRouteInfo(binding), responseMetadata: {} },
      }));
      appendHistory({
        id: `img-${Date.now().toString(36)}`,
        timestamp: Date.now(),
        prompt: asString(requestParams.prompt),
        negativePrompt: asString(requestParams.negativePrompt),
        size: asString(requestParams.size),
        result: 'failed',
        error: message,
        imageUris: [],
        rawResponse,
      });
    }
  }, [appendHistory, buildRequestContext, onStateChange, watchAsyncImageJob]);

  const canSubmit = !state.busy && Boolean(draft.prompt.trim());
  const runLabel = mode === 'job'
    ? t('Tester.imageGenerate.submitJob', { defaultValue: 'Submit Job' })
    : t('Tester.imageGenerate.runGenerate', { defaultValue: 'Generate' });

  return (
    <div className="flex flex-col gap-3">
      {mode === 'job' ? (
        <div className="flex items-center gap-2 rounded-[var(--nimi-radius-lg)] border border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] px-3 py-2">
          <span className="shrink-0 text-xs text-[var(--nimi-text-muted)]">
            {t('Tester.imageGenerate.watch', { defaultValue: 'Watch' })}
          </span>
          <TextField
            className="flex-1 font-mono text-xs"
            value={watchJobId}
            onChange={(event) => setWatchJobId(event.target.value)}
            placeholder={t('Tester.imageGenerate.jobIdPlaceholder', { defaultValue: 'Job ID...' })}
          />
          <Button
            tone="secondary"
            size="sm"
            disabled={state.busy || !asString(watchJobId)}
            onClick={() => {
              void watchAsyncImageJob({
                jobId: asString(watchJobId),
                requestParams: { jobId: watchJobId, mode: 'attach' },
                routeInfo: null,
              });
            }}
          >
            {t('Tester.imageGenerate.watch', { defaultValue: 'Watch' })}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 pb-2 pt-3 transition-colors">
        <textarea
          value={draft.prompt}
          onChange={(event) => updateDraft({ prompt: event.target.value })}
          placeholder={t('Tester.imageGenerate.promptPlaceholder', { defaultValue: 'Describe the image you want to generate...' })}
          rows={5}
          className="w-full resize-none border-0 bg-transparent px-0 py-0 text-sm leading-relaxed text-[var(--nimi-text-primary)] outline-none placeholder:text-[var(--nimi-text-muted)]"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSubmit) {
              event.preventDefault();
              void handleRun();
            }
          }}
        />
        {draft.negativePrompt ? (
          <div className="mt-1 truncate text-[11px] text-[var(--nimi-text-muted)]">
            <span className="mr-1 uppercase tracking-wide">{t('Tester.imageGenerate.negativePromptShort', { defaultValue: 'neg:' })}</span>
            <span className="font-mono">{draft.negativePrompt}</span>
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <GenerationPrefsPopover
            size={draft.size}
            count={draft.n}
            onSizeChange={(next) => updateDraft({ size: next })}
            onCountChange={(next) => updateDraft({ n: next })}
          />

          {draft.seed ? <span className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-0.5 font-mono text-[11px] text-[var(--nimi-text-muted)]">seed:{draft.seed}</span> : null}
          {draft.responseFormatMode && draft.responseFormatMode !== 'auto' ? <span className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-0.5 font-mono text-[11px] text-[var(--nimi-text-muted)]">{draft.responseFormatMode}</span> : null}

          {mode !== 'job' ? (
            <div ref={watchWrapperRef} className="relative inline-flex">
              <button
                type="button"
                onClick={() => setWatchPopoverOpen((v) => !v)}
                aria-expanded={watchPopoverOpen}
                aria-label={t('Tester.imageGenerate.watchExisting', { defaultValue: 'Watch existing job' })}
                title={t('Tester.imageGenerate.watchExisting', { defaultValue: 'Watch existing job' })}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  watchPopoverOpen
                    ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
                    : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-muted)] hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-secondary)]'
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>{t('Tester.imageGenerate.watch', { defaultValue: 'Watch' })}</span>
              </button>

              {watchPopoverOpen ? (
                <div
                  role="dialog"
                  aria-label={t('Tester.imageGenerate.watchExisting', { defaultValue: 'Watch existing job' })}
                  className="absolute top-[calc(100%+0.5rem)] left-0 z-[var(--nimi-z-popover,40)] w-[280px] rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-3 shadow-[var(--nimi-elevation-floating)]"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--nimi-text-muted)]">
                    {t('Tester.imageGenerate.watchExisting', { defaultValue: 'Watch existing job' })}
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-[var(--nimi-text-muted)]">
                    {t('Tester.imageGenerate.watchHint', { defaultValue: 'Reattach to a previously submitted job by its ID.' })}
                  </p>
                  <input
                    type="text"
                    value={watchJobId}
                    onChange={(event) => setWatchJobId(event.target.value)}
                    placeholder={t('Tester.imageGenerate.jobIdPlaceholder', { defaultValue: 'Job ID...' })}
                    className="mt-2 w-full rounded-[var(--nimi-radius-sm)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 py-1.5 font-mono text-xs text-[var(--nimi-text-primary)] outline-none transition-colors focus:border-[var(--nimi-action-primary-bg)]"
                  />
                  <div className="mt-2 flex justify-end">
                    <Button
                      tone="primary"
                      size="sm"
                      disabled={state.busy || !asString(watchJobId)}
                      onClick={() => {
                        void watchAsyncImageJob({ jobId: asString(watchJobId), requestParams: { jobId: watchJobId, mode: 'attach' }, routeInfo: null });
                        setWatchPopoverOpen(false);
                      }}
                    >
                      {t('Tester.imageGenerate.watch', { defaultValue: 'Watch' })}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="ml-auto flex items-center gap-1.5">
            <ImageAdvancedParamsPopover
              draft={draft}
              onDraftChange={updateDraft}
              showWorkflowSlots={usesLocalImageWorkflow}
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
      {state.busy && state.busyLabel ? (
        <div className="text-xs text-[var(--nimi-text-muted)]">{state.busyLabel}</div>
      ) : null}

      <OutputGallery
        records={history}
        busy={state.busy}
        busyLabel={state.busyLabel || ''}
        onDelete={deleteHistoryRecord}
        onClear={clearHistory}
      />

      {jobTimeline.length > 0 ? (
        <div className="rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-canvas)] p-2 text-xs">
          <div className="mb-1 font-semibold text-[var(--nimi-text-secondary)]">{t('Tester.imageGenerate.jobTimeline')}</div>
          {jobTimeline.map((event, i) => (
            <div key={i} className="text-[var(--nimi-text-primary)]">{`[${event.sequence}] ${event.label}: ${event.status}${asString(event.progressLabel) ? ` · ${asString(event.progressLabel)}` : ''}`}</div>
          ))}
        </div>
      ) : null}

      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
