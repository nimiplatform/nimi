import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import {
  IMAGE_WORKFLOW_PRESET_SELECTIONS,
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
import { getRuntimeClient, resolveCallParams, bindingToRouteInfo } from '../tester-runtime.js';
import { DiagnosticsPanel, ErrorBox, RawJsonSection, RunButton } from '../tester-diagnostics.js';
import { buildLocalProfileExtensions, createModRuntimeClient, type ModRuntimeBoundImageGenerateInput } from '@nimiplatform/sdk/mod';

type ImageGeneratePanelProps = {
  mode: 'generate' | 'job';
  state: CapabilityState;
  draft: ImageWorkflowDraftState;
  onDraftChange: React.Dispatch<React.SetStateAction<ImageWorkflowDraftState>>;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

function buildProfileOverrides(input: {
  step: string; cfgScale: string; sampler: string; scheduler: string;
  optionsText: string; rawJsonText: string;
}): { overrides: Record<string, unknown> | undefined; error: string } {
  const overrides: Record<string, unknown> = {};
  const step = Number(input.step);
  if (input.step && Number.isFinite(step) && step > 0) overrides.steps = step;
  const cfgScale = Number(input.cfgScale);
  if (input.cfgScale && Number.isFinite(cfgScale)) overrides.cfg_scale = cfgScale;
  if (asString(input.sampler)) overrides.sampler = asString(input.sampler);
  if (asString(input.scheduler)) overrides.scheduler = asString(input.scheduler);
  if (asString(input.optionsText)) {
    for (const line of input.optionsText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separatorIdx = trimmed.indexOf(':');
      if (separatorIdx < 1) {
        overrides[trimmed] = true;
        continue;
      }
      const key = trimmed.slice(0, separatorIdx).trim();
      const val = trimmed.slice(separatorIdx + 1).trim();
      overrides[key] = val === 'true' ? true : val === 'false' ? false : val;
    }
  }
  if (asString(input.rawJsonText)) {
    try {
      const parsed = JSON.parse(input.rawJsonText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.assign(overrides, parsed);
      }
    } catch {
      return { overrides: undefined, error: 'Invalid JSON in profile overrides.' };
    }
  }
  return { overrides: Object.keys(overrides).length > 0 ? overrides : undefined, error: '' };
}

const TESTER_IMAGE_MAIN_ENTRY_ID = 'tester/image-main-model';

function buildWorkflowExtensions(input: {
  draft: ImageWorkflowDraftState;
  profileOverrides: Record<string, unknown> | undefined;
  mainLocalAssetId: string;
  mainAssetId: string;
}): { extensions: Record<string, unknown> | undefined; error: string } {
  const { draft, profileOverrides, mainLocalAssetId, mainAssetId } = input;
  const entryOverrides: Array<{ entryId: string; localAssetId: string }> = [];
  if (mainLocalAssetId) {
    entryOverrides.push({ entryId: TESTER_IMAGE_MAIN_ENTRY_ID, localAssetId: mainLocalAssetId });
  }
  for (const preset of IMAGE_WORKFLOW_PRESET_SELECTIONS) {
    const val = draft[preset.key];
    if (asString(val)) {
      entryOverrides.push({ entryId: `tester/image-slot/${preset.slot}`, localAssetId: val });
    }
  }
  for (const comp of draft.componentDrafts) {
    if (asString(comp.slot) && asString(comp.localArtifactId)) {
      entryOverrides.push({ entryId: `tester/image-slot/${comp.slot}`, localAssetId: comp.localArtifactId });
    }
  }
  if (entryOverrides.length === 0 && !profileOverrides) {
    return { extensions: undefined, error: '' };
  }
  const extensions = buildLocalProfileExtensions({
    entryOverrides,
    profileOverrides: profileOverrides || {},
  });
  const companionProfileEntries = IMAGE_WORKFLOW_PRESET_SELECTIONS
    .filter((preset) => asString(draft[preset.key]))
    .map((preset) => ({
      entryId: `tester/image-slot/${preset.slot}`,
      kind: 'asset',
      capability: 'image',
      title: `Workflow slot ${preset.slot}`,
      required: true,
      preferred: true,
      assetId: preset.slot,
      assetKind: preset.kind,
      engineSlot: preset.slot,
    }));
  extensions.profile_entries = [
    {
      entryId: TESTER_IMAGE_MAIN_ENTRY_ID,
      kind: 'asset',
      capability: 'image',
      title: 'Selected local image model',
      required: true,
      preferred: true,
      assetId: mainAssetId || mainLocalAssetId,
      assetKind: 'image',
    },
    ...companionProfileEntries,
  ];
  return { extensions, error: '' };
}

function formatRelativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatScenarioJobProgress(job: Record<string, unknown> | null | undefined): string {
  const record = job || {};
  const progressPercent = Number(record.progressPercent ?? record.progress);
  const currentStep = Number(record.progressCurrentStep ?? record.progress_current_step);
  const totalSteps = Number(record.progressTotalSteps ?? record.progress_total_steps);
  const parts: string[] = [];
  if (Number.isFinite(progressPercent) && progressPercent >= 0) {
    parts.push(`${Math.round(progressPercent)}%`);
  }
  if (Number.isFinite(currentStep) && currentStep > 0 && Number.isFinite(totalSteps) && totalSteps > 0) {
    parts.push(`${Math.round(currentStep)}/${Math.round(totalSteps)}`);
  }
  return parts.join(' · ');
}

function ImageHistoryPanel({ records, onDelete, onClear }: {
  records: ImageGenerationRecord[];
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  if (records.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--nimi-text-secondary)]">
          {t('Tester.imageGenerate.history', { defaultValue: 'History' })} ({records.length})
        </span>
        <Button tone="ghost" size="sm" onClick={onClear}>
          {t('Tester.imageGenerate.clearHistory', { defaultValue: 'Clear All' })}
        </Button>
      </div>
      {records.map((record) => {
        const expanded = expandedId === record.id;
        return (
          <div key={record.id} className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]">
            <div className="flex items-center gap-2 p-2 text-xs">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => setExpandedId(expanded ? null : record.id)}
              >
                {record.imageUris[0] ? (
                  <img src={record.imageUris[0]} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-[var(--nimi-surface-raised)] text-[var(--nimi-text-muted)]">
                    {record.result === 'failed' ? '!' : '?'}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[var(--nimi-text-primary)]">{record.prompt || '(empty prompt)'}</div>
                  <div className="text-[var(--nimi-text-muted)]">
                    {record.size} · {record.elapsed ? `${(record.elapsed / 1000).toFixed(1)}s` : '—'} · {formatRelativeTime(record.timestamp)}
                    {record.result === 'failed' ? ' · failed' : ''}
                  </div>
                </div>
              </button>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-surface-raised)] hover:text-[var(--nimi-accent-danger)]"
                onClick={() => onDelete(record.id)}
                aria-label="Delete"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              </button>
            </div>
            {expanded ? (
              <div className="flex flex-col gap-2 border-t border-[var(--nimi-border-subtle)] p-2">
                {record.imageUris.length > 0 ? <ImagePreviewGrid uris={record.imageUris} /> : null}
                {record.error ? <div className="rounded bg-[var(--nimi-accent-danger)]/10 p-2 text-xs text-[var(--nimi-accent-danger)]">{record.error}</div> : null}
                {record.rawResponse ? <RawJsonSection content={record.rawResponse} /> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ImagePreviewGrid({ uris }: { uris: string[] }) {
  const [preview, setPreview] = React.useState<string | null>(null);
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {uris.map((uri) => (
          <button key={uri} type="button" className="cursor-pointer overflow-hidden rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] transition-opacity hover:opacity-80" onClick={() => setPreview(uri)}>
            <img alt="Generated image" src={uri} className="block w-full" />
          </button>
        ))}
      </div>
      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8" onClick={() => setPreview(null)}>
          <button
            type="button"
            className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/40"
            onClick={() => setPreview(null)}
            aria-label="Close preview"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          <img alt="Preview" src={preview} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      ) : null}
    </>
  );
}

export function ImageGeneratePanel(props: ImageGeneratePanelProps) {
  const { t } = useTranslation();
  const { mode, state, draft, onDraftChange, onStateChange } = props;
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
  const isLocalRuntimeWorkflow = effectiveBinding?.source === 'local';
  const localEngine = asString(isLocalRuntimeWorkflow ? (effectiveBinding?.engine || effectiveBinding?.provider) : '');
  const isMediaImageWorkflow = isLocalRuntimeWorkflow && localEngine.toLowerCase() === 'media';

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
    if (isMediaImageWorkflow) {
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
  }, [draft, effectiveBinding, isMediaImageWorkflow]);

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
    onStateChange((prev) => ({
      ...prev,
      busy: false,
      busyLabel: '',
      result: outcome.result,
      error: outcome.error,
      output: uris,
      rawResponse: toPrettyJson({
        request: input.requestParams,
        jobId: input.jobId,
        job: input.job,
        events: jobTimeline,
        artifacts: stripArtifacts({ artifacts: artifactsResponse.artifacts }),
        previewUris: uris,
      }),
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
  }, [jobTimeline, onStateChange]);

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
    const t0 = Date.now();
    const binding = requestContext.binding;
    const requestParams = requestContext.requestParams;
    try {
      const routeInfo = bindingToRouteInfo(binding);
      if (mode === 'job') {
        const modClient = createModRuntimeClient('core:runtime');
        const job = await modClient.media.jobs.submit({ modal: 'image', input: requestParams as unknown as ModRuntimeBoundImageGenerateInput });
        await watchAsyncImageJob({
          jobId: asString((job as unknown as Record<string, unknown>)?.jobId),
          requestParams,
          routeInfo,
          initialJob: job as unknown as Record<string, unknown>,
        });
        return;
      }
      const callParams = await resolveCallParams(binding);
      const result = await getRuntimeClient().media.image.generate({
        model: callParams.model,
        route: callParams.route,
        connectorId: callParams.connectorId,
        prompt: asString(requestParams.prompt),
        ...(requestParams.size ? { size: asString(requestParams.size) } : {}),
        ...(requestParams.seed !== undefined ? { seed: requestParams.seed as number } : {}),
        ...(requestParams.responseFormat ? { responseFormat: requestParams.responseFormat as 'base64' | 'url' } : {}),
        ...(requestParams.extensions ? { extensions: requestParams.extensions as Record<string, unknown> } : {}),
        metadata: callParams.metadata,
      });
      const elapsed = Date.now() - t0;
      const uris = result.artifacts
        .map((artifact) => toArtifactPreviewUri({ uri: artifact.uri, bytes: artifact.bytes, mimeType: artifact.mimeType, defaultMimeType: 'image/png' }))
        .filter(Boolean);
      const rawResponse = toPrettyJson({ request: requestParams, response: stripArtifacts(result), previewUris: uris });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'passed',
        output: uris,
        rawResponse,
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
      appendHistory({
        id: `img-${Date.now().toString(36)}`,
        timestamp: Date.now(),
        prompt: asString(requestParams.prompt),
        negativePrompt: asString(requestParams.negativePrompt),
        size: asString(requestParams.size),
        result: 'passed',
        imageUris: uris,
        rawResponse,
        elapsed,
      });
    } catch (error) {
      const elapsed = Date.now() - t0;
      const message = error instanceof Error ? error.message : String(error || (mode === 'job' ? 'Job submission failed.' : 'Image generation failed.'));
      const rawResponse = toPrettyJson({ request: requestParams, error: message });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'failed',
        error: message,
        output: [],
        rawResponse,
        diagnostics: { requestParams, resolvedRoute: bindingToRouteInfo(binding), responseMetadata: { elapsed } },
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
        elapsed,
      });
    }
  }, [appendHistory, buildRequestContext, mode, onStateChange, watchAsyncImageJob]);

  const imageUris = (state.output as string[] | null) || [];

  return (
    <div className="flex flex-col gap-3">
      <TextareaField className="font-mono text-xs" textareaClassName="h-20" value={draft.prompt} onChange={(event) => updateDraft({ prompt: event.target.value })} placeholder={t('Tester.imageGenerate.promptPlaceholder')} />
      <TextareaField className="font-mono text-xs" textareaClassName="h-14" value={draft.negativePrompt} onChange={(event) => updateDraft({ negativePrompt: event.target.value })} placeholder={t('Tester.imageGenerate.negativePromptPlaceholder')} />

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--nimi-text-muted)]">{t('Tester.imageGenerate.size')}</span>
          <TextField className="font-mono text-xs" value={draft.size} onChange={(event) => updateDraft({ size: event.target.value })} placeholder={t('Tester.imageGenerate.sizePlaceholder')} />
        </div>
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--nimi-text-muted)]">{t('Tester.imageGenerate.count')}</span>
          <TextField className="font-mono text-xs" type="number" min="1" max="4" value={draft.n} onChange={(event) => updateDraft({ n: event.target.value })} />
        </div>
      </div>

      {mode === 'job' ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <TextField className="flex-1 font-mono text-xs" value={watchJobId} onChange={(event) => setWatchJobId(event.target.value)} placeholder={t('Tester.imageGenerate.jobIdPlaceholder')} />
            <Button tone="secondary" size="sm" disabled={state.busy} onClick={() => { void watchAsyncImageJob({ jobId: asString(watchJobId), requestParams: { jobId: watchJobId, mode: 'attach' }, routeInfo: null }); }}>
              {t('Tester.imageGenerate.watch')}
            </Button>
          </div>
          <RunButton busy={state.busy} busyLabel={state.busyLabel} label={t('Tester.imageGenerate.submitJob')} onClick={() => { void handleRun(); }} />
          {jobTimeline.length > 0 ? (
            <div className="rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-canvas)] p-2 text-xs">
              <div className="font-semibold text-[var(--nimi-text-secondary)] mb-1">{t('Tester.imageGenerate.jobTimeline')}</div>
              {jobTimeline.map((event, i) => (
                <div key={i} className="text-[var(--nimi-text-primary)]">{`[${event.sequence}] ${event.label}: ${event.status}${asString(event.progressLabel) ? ` · ${asString(event.progressLabel)}` : ''}`}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <RunButton busy={state.busy} busyLabel={state.busyLabel} label={t('Tester.imageGenerate.runGenerate')} onClick={() => { void handleRun(); }} />
      )}

      {state.error ? <ErrorBox message={state.error} /> : null}
      {imageUris.length > 0 ? (
        <ImagePreviewGrid uris={imageUris} />
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
      <ImageHistoryPanel records={history} onDelete={deleteHistoryRecord} onClear={clearHistory} />
    </div>
  );
}
