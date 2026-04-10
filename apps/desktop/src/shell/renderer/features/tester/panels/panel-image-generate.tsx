import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  IMAGE_WORKFLOW_PRESET_SELECTIONS,
  type CapabilityState,
  type ImageWorkflowDraftState,
  type ImageWorkflowPresetSelectionKey,
  type ImageResponseFormatMode,
} from '../tester-types.js';
import {
  asString,
  buildAsyncImageJobOutcome,
  isTerminalScenarioJobStatus,
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
import { createModRuntimeClient, type ModRuntimeBoundImageGenerateInput, type ModRuntimeLocalAssetRecord } from '@nimiplatform/sdk/mod';

type ImageGeneratePanelProps = {
  mode: 'generate' | 'job';
  state: CapabilityState;
  draft: ImageWorkflowDraftState;
  onDraftChange: React.Dispatch<React.SetStateAction<ImageWorkflowDraftState>>;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

function isSelectableLocalArtifact(artifact: ModRuntimeLocalAssetRecord): boolean {
  const status = Number(artifact.status || 0);
  return status !== 3 && status !== 4 && Boolean(artifact.localAssetId);
}

function artifactDisplayLabel(artifact: ModRuntimeLocalAssetRecord): string {
  return asString(artifact.assetId || artifact.localAssetId);
}

function artifactsForPresetKind(artifacts: ModRuntimeLocalAssetRecord[], kind: string): ModRuntimeLocalAssetRecord[] {
  return artifacts.filter((a) => isSelectableLocalArtifact(a) && asString(a.kind) === kind);
}

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

function buildWorkflowExtensions(input: {
  draft: ImageWorkflowDraftState;
  profileOverrides: Record<string, unknown> | undefined;
}): { extensions: Record<string, unknown> | undefined; error: string } {
  const { draft, profileOverrides } = input;
  const entryOverrides: Array<{ slot: string; localArtifactId: string }> = [];
  for (const preset of IMAGE_WORKFLOW_PRESET_SELECTIONS) {
    const val = draft[preset.key];
    if (asString(val)) {
      entryOverrides.push({ slot: preset.slot, localArtifactId: val });
    }
  }
  for (const comp of draft.componentDrafts) {
    if (asString(comp.slot) && asString(comp.localArtifactId)) {
      entryOverrides.push({ slot: comp.slot, localArtifactId: comp.localArtifactId });
    }
  }
  if (entryOverrides.length === 0 && !profileOverrides) {
    return { extensions: undefined, error: '' };
  }
  return {
    extensions: {
      workflow: {
        ...(entryOverrides.length > 0 ? { entryOverrides } : {}),
        ...(profileOverrides ? { profileOverrides } : {}),
      },
    },
    error: '',
  };
}

export function ImageGeneratePanel(props: ImageGeneratePanelProps) {
  const { t } = useTranslation();
  const { mode, state, draft, onDraftChange, onStateChange } = props;
  const [artifacts, setArtifacts] = React.useState<ModRuntimeLocalAssetRecord[]>([]);
  const [artifactLoading, setArtifactLoading] = React.useState(false);
  const [artifactError, setArtifactError] = React.useState('');
  const [watchJobId, setWatchJobId] = React.useState('');
  const [jobTimeline, setJobTimeline] = React.useState<Array<Record<string, unknown>>>([]);
  const watchSequenceRef = React.useRef(0);

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

  // Load companion artifacts for local media workflow
  React.useEffect(() => {
    if (!isMediaImageWorkflow) {
      setArtifacts([]);
      setArtifactLoading(false);
      setArtifactError('');
      return;
    }
    let cancelled = false;
    setArtifactLoading(true);
    setArtifactError('');
    void (async () => {
      try {
        const modClient = createModRuntimeClient('core:runtime');
        const rows = await modClient.local.listAssets({
          engine: 'media',
        });
        if (cancelled) return;
        setArtifacts(rows);
        setArtifactLoading(false);
      } catch (error) {
        if (cancelled) return;
        setArtifacts([]);
        setArtifactLoading(false);
        setArtifactError(error instanceof Error ? error.message : String(error || 'Failed to load local artifacts.'));
      }
    })();
    return () => { cancelled = true; };
  }, [isMediaImageWorkflow, effectiveBinding]);

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
      const localWorkflow = buildWorkflowExtensions({
        draft, profileOverrides: profileOverridesResult.overrides,
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
      setJobTimeline((prev) => [...prev, {
        sequence: sequence ?? prev.length + 1,
        label,
        status: scenarioJobStatusLabel(normalizedJob.status),
        reasonDetail: asString(normalizedJob.reasonDetail) || undefined,
      }]);
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
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'passed',
        output: uris,
        rawResponse: toPrettyJson({ request: requestParams, response: stripArtifacts(result), previewUris: uris }),
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
      const message = error instanceof Error ? error.message : String(error || (mode === 'job' ? 'Job submission failed.' : 'Image generation failed.'));
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'failed',
        error: message,
        output: [],
        rawResponse: toPrettyJson({ request: requestParams, error: message }),
        diagnostics: { requestParams, resolvedRoute: bindingToRouteInfo(binding), responseMetadata: { elapsed } },
      }));
    }
  }, [buildRequestContext, mode, onStateChange, watchAsyncImageJob]);

  const imageUris = (state.output as string[] | null) || [];

  const companionPresetArtifacts = React.useMemo(() => (
    Object.fromEntries(IMAGE_WORKFLOW_PRESET_SELECTIONS.map((preset) => [
      preset.key,
      artifactsForPresetKind(artifacts, preset.kind),
    ])) as Record<ImageWorkflowPresetSelectionKey, ModRuntimeLocalAssetRecord[]>
  ), [artifacts]);

  return (
    <div className="flex flex-col gap-3">
      {/* Prompt inputs */}
      <textarea className="h-20 w-full resize-y rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs" value={draft.prompt} onChange={(event) => updateDraft({ prompt: event.target.value })} placeholder={t('Tester.imageGenerate.promptPlaceholder')} />
      <textarea className="h-14 w-full resize-y rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs" value={draft.negativePrompt} onChange={(event) => updateDraft({ negativePrompt: event.target.value })} placeholder={t('Tester.imageGenerate.negativePromptPlaceholder')} />

      {/* Size and count */}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-500">{t('Tester.imageGenerate.size')}</span>
          <input className="rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs" value={draft.size} onChange={(event) => updateDraft({ size: event.target.value })} placeholder={t('Tester.imageGenerate.sizePlaceholder')} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-gray-500">{t('Tester.imageGenerate.count')}</span>
          <input type="number" min="1" max="4" className="rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs" value={draft.n} onChange={(event) => updateDraft({ n: event.target.value })} />
        </label>
      </div>

      {/* Companion models for media workflow */}
      {isMediaImageWorkflow ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="mb-2 text-xs font-semibold text-gray-700">{t('Tester.imageGenerate.companionModels')}</div>
          {artifactLoading ? <div className="rounded-md bg-blue-50 p-2 text-[11px] text-blue-700">{t('Tester.imageGenerate.loadingArtifacts')}</div> : null}
          {artifactError ? <div className="rounded-md bg-red-50 p-2 text-[11px] text-red-700">{artifactError}</div> : null}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {IMAGE_WORKFLOW_PRESET_SELECTIONS.map((preset) => {
              const presetArtifacts = companionPresetArtifacts[preset.key] || [];
              return (
                <label key={preset.key} className="flex flex-col gap-1 text-xs">
                  <span className="text-gray-500">{preset.key}</span>
                  <select className="rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs" value={draft[preset.key]} onChange={(event) => updateDraft({ [preset.key]: event.target.value } as Partial<ImageWorkflowDraftState>)} disabled={artifactLoading || presetArtifacts.length === 0}>
                    <option value="">{t('Tester.imageGenerate.optional')}</option>
                    {presetArtifacts.map((artifact) => (
                      <option key={artifact.localAssetId} value={artifact.localAssetId}>{artifactDisplayLabel(artifact)}</option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Advanced options */}
      <details className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs">
        <summary className="cursor-pointer font-semibold text-gray-600">{t('Tester.imageGenerate.advancedOptions')}</summary>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-gray-500">{t('Tester.imageGenerate.responseFormat')}</span>
            <select className="rounded-md border border-gray-300 bg-white px-2 py-1" value={draft.responseFormatMode} onChange={(event) => updateDraft({ responseFormatMode: event.target.value as ImageResponseFormatMode })}>
              <option value="auto">auto</option>
              <option value="base64">base64</option>
              <option value="url">url</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-gray-500">{t('Tester.imageGenerate.seed')}</span>
            <input className="rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs" value={draft.seed} onChange={(event) => updateDraft({ seed: event.target.value })} placeholder={t('Tester.imageGenerate.optional')} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-gray-500">{t('Tester.imageGenerate.timeoutMs')}</span>
            <input className="rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs" value={draft.timeoutMs} onChange={(event) => updateDraft({ timeoutMs: event.target.value })} placeholder={t('Tester.imageGenerate.timeoutPlaceholder')} />
          </label>
        </div>
        {isMediaImageWorkflow ? (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-gray-500">{t('Tester.imageGenerate.steps')}</span>
              <input className="rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs" value={draft.step} onChange={(event) => updateDraft({ step: event.target.value })} placeholder={t('Tester.imageGenerate.stepsPlaceholder')} />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-gray-500">{t('Tester.imageGenerate.cfgScale')}</span>
              <input className="rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs" value={draft.cfgScale} onChange={(event) => updateDraft({ cfgScale: event.target.value })} placeholder={t('Tester.imageGenerate.optional')} />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-gray-500">{t('Tester.imageGenerate.sampler')}</span>
              <input className="rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs" value={draft.sampler} onChange={(event) => updateDraft({ sampler: event.target.value })} placeholder={t('Tester.imageGenerate.samplerPlaceholder')} />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-gray-500">{t('Tester.imageGenerate.scheduler')}</span>
              <input className="rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs" value={draft.scheduler} onChange={(event) => updateDraft({ scheduler: event.target.value })} placeholder={t('Tester.imageGenerate.optional')} />
            </label>
          </div>
        ) : null}
      </details>

      {/* Job mode controls */}
      {mode === 'job' ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input className="flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs" value={watchJobId} onChange={(event) => setWatchJobId(event.target.value)} placeholder={t('Tester.imageGenerate.jobIdPlaceholder')} />
            <button type="button" className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs" disabled={state.busy} onClick={() => { void watchAsyncImageJob({ jobId: asString(watchJobId), requestParams: { jobId: watchJobId, mode: 'attach' }, routeInfo: null }); }}>
              {t('Tester.imageGenerate.watch')}
            </button>
          </div>
          <RunButton busy={state.busy} busyLabel={state.busyLabel} label={t('Tester.imageGenerate.submitJob')} onClick={() => { void handleRun(); }} />
          {jobTimeline.length > 0 ? (
            <div className="rounded-md bg-gray-50 p-2 text-xs">
              <div className="font-semibold text-gray-600 mb-1">{t('Tester.imageGenerate.jobTimeline')}</div>
              {jobTimeline.map((event, i) => (
                <div key={i} className="text-gray-700">{`[${event.sequence}] ${event.label}: ${event.status}`}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <RunButton busy={state.busy} busyLabel={state.busyLabel} label={t('Tester.imageGenerate.runGenerate')} onClick={() => { void handleRun(); }} />
      )}

      {state.error ? <ErrorBox message={state.error} /> : null}
      {imageUris.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {imageUris.map((uri) => (
            <img key={uri} alt="Generated image" src={uri} className="rounded-lg border border-gray-200" />
          ))}
        </div>
      ) : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
