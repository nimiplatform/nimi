import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CapabilityState, VideoGenerationRecord } from '../tester-types.js';
import type { VideoParamsState } from '@nimiplatform/nimi-kit/features/model-config';
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
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { getRuntimeClient, resolveCallParams, bindingToRouteInfo } from '../tester-runtime.js';
import { DiagnosticsPanel, ErrorBox, RawJsonSection } from '../tester-diagnostics.js';
import { createModRuntimeClient, type ModRuntimeBoundVideoGenerateInput } from '@nimiplatform/sdk/mod';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type VideoGeneratePanelProps = {
  mode: 'generate' | 'job';
  state: CapabilityState;
  binding?: CapabilityState['binding'];
  params: VideoParamsState;
  onParamsChange: (next: VideoParamsState) => void;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};
import {
  ARROW_UP_ICON,
  HISTORY_LIMIT,
  LOCK_ICON,
  PROMPT_MAX,
  SOUND_ICON,
  formatScenarioJobProgress,
  isI2vMode,
  type VideoMode,
} from './panel-video-generate-shared.js';
import {
  CompactUploadTile,
  DurationChip,
  ModeChip,
  PreviewPanel,
  RatioResolutionChip,
  ToggleChip,
  WatchJobLink,
  type PreviewState,
} from './panel-video-generate-controls.js';
import { HistoryGallery } from './panel-video-generate-history.js';

export function VideoGeneratePanel(props: VideoGeneratePanelProps) {
  const { t } = useTranslation();
  const { mode, onParamsChange, params, state, onStateChange } = props;
  const [prompt, setPrompt] = React.useState('A serene mountain landscape with flowing clouds.');
  const [negativePrompt, setNegativePrompt] = React.useState('');
  const [refImageUri, setRefImageUri] = React.useState('');
  const [jobTimeline, setJobTimeline] = React.useState<Array<Record<string, unknown>>>([]);
  const watchSequenceRef = React.useRef(0);
  const [history, setHistory] = React.useState<VideoGenerationRecord[]>([]);
  const isI2v = isI2vMode(params.mode);
  const resolvedMode = params.mode as VideoMode | 'i2v-first-last';
  const currentTab = (params.mode === 'i2v-first-last' ? 'i2v-reference' : (params.mode as VideoMode));

  const appendHistory = React.useCallback((record: VideoGenerationRecord) => {
    setHistory((prev) => [record, ...prev].slice(0, HISTORY_LIMIT));
  }, []);
  const deleteHistoryRecord = React.useCallback((id: string) => {
    setHistory((prev) => prev.filter((r) => r.id !== id));
  }, []);
  const clearHistory = React.useCallback(() => setHistory([]), []);

  const handleModeChange = React.useCallback((nextMode: VideoMode) => {
    onParamsChange({ ...params, mode: nextMode });
    if (nextMode === 't2v') setRefImageUri('');
  }, [params, onParamsChange]);

  const buildVideoContentItems = React.useCallback((): Array<
    | { type: 'text'; role: 'prompt'; text: string }
    | { type: 'image_url'; role: 'reference_image' | 'first_frame'; imageUrl: string }
  > => {
    const items: Array<
      | { type: 'text'; role: 'prompt'; text: string }
      | { type: 'image_url'; role: 'reference_image' | 'first_frame'; imageUrl: string }
    > = [{ type: 'text', role: 'prompt', text: prompt }];
    if (isI2v && asString(refImageUri)) {
      const role = params.mode === 'i2v-first-frame' ? 'first_frame' : 'reference_image';
      items.push({ type: 'image_url', role, imageUrl: refImageUri });
    }
    return items;
  }, [isI2v, params.mode, prompt, refImageUri]);

  const buildVideoOptions = React.useCallback(() => ({
    ratio: params.ratio,
    durationSec: Number(params.durationSec) || 5,
    generateAudio: params.generateAudio,
    ...(params.resolution ? { resolution: params.resolution } : {}),
    ...(params.fps ? { fps: Number(params.fps) || undefined } : {}),
    ...(params.seed ? { seed: Number(params.seed) || undefined } : {}),
    ...(params.timeoutMs ? { timeoutMs: Number(params.timeoutMs) || undefined } : {}),
    ...(params.cameraFixed ? { cameraFixed: true } : {}),
    ...(asString(negativePrompt) ? { negativePrompt } : {}),
  }), [params, negativePrompt]);

  const finalizeAsyncVideoJob = React.useCallback(async (input: {
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
      artifactFetchError = error instanceof Error ? error.message : String(error || 'Failed to fetch video job artifacts.');
    }

    const firstVideoArtifact = (artifactsResponse.artifacts || []).find((a) => {
      const mime = asString(a.mimeType);
      return mime.startsWith('video/') || (!mime && asString(a.uri));
    });
    const playbackUri = firstVideoArtifact
      ? toArtifactPreviewUri({ uri: firstVideoArtifact.uri, bytes: firstVideoArtifact.bytes, mimeType: firstVideoArtifact.mimeType, defaultMimeType: 'video/mp4' })
      : '';

    const jobRecord = input.job || {};
    const playbackError = (!artifactFetchError && !playbackUri && scenarioJobStatusLabel(jobRecord.status) === 'completed')
      ? 'Job completed but no playable video artifact was returned.'
      : '';
    const combinedArtifactError = [artifactFetchError, playbackError].filter(Boolean).join(' | ');
    const outcome = buildAsyncImageJobOutcome({ status: jobRecord.status, reasonDetail: jobRecord.reasonDetail, artifactFetchError: combinedArtifactError });
    const rawResponse = toPrettyJson({
      request: input.requestParams,
      jobId: input.jobId,
      job: input.job,
      events: jobTimeline,
      artifacts: stripArtifacts({ artifacts: artifactsResponse.artifacts }),
      playbackUri: playbackUri || undefined,
    });
    onStateChange((prev) => ({
      ...prev,
      busy: false,
      busyLabel: '',
      result: outcome.result,
      error: outcome.error,
      output: playbackUri || null,
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
      id: `vid-${Date.now().toString(36)}`,
      timestamp: Date.now(),
      mode: asString(reqParams.mode) || params.mode,
      prompt: asString(reqParams.prompt),
      negativePrompt: asString((reqParams.options as Record<string, unknown> | undefined)?.negativePrompt),
      ratio: asString((reqParams.options as Record<string, unknown> | undefined)?.ratio) || params.ratio,
      durationSec: String((reqParams.options as Record<string, unknown> | undefined)?.durationSec ?? params.durationSec),
      result: outcome.result === 'passed' ? 'passed' : 'failed',
      error: outcome.error || undefined,
      videoUri: playbackUri,
      rawResponse,
      elapsed: input.elapsed,
    });
  }, [appendHistory, jobTimeline, onStateChange, params.durationSec, params.mode, params.ratio]);

  const watchAsyncVideoJob = React.useCallback(async (input: {
    jobId: string;
    requestParams: Record<string, unknown> | null;
    routeInfo: Record<string, unknown> | null;
    initialJob?: Record<string, unknown> | null;
  }) => {
    const watchToken = ++watchSequenceRef.current;
    const startedAt = Date.now();
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
    onStateChange((prev) => ({
      ...prev,
      busy: true,
      busyLabel: 'Watching job...',
      error: '',
      output: null,
      diagnostics: { requestParams: input.requestParams, resolvedRoute: input.routeInfo as any, responseMetadata: { jobId: input.jobId } },
    }));
    const modClient = createModRuntimeClient('core:runtime');
    let currentJob = input.initialJob || await modClient.media.jobs.get(input.jobId) as unknown as Record<string, unknown>;
    if (watchToken !== watchSequenceRef.current) return;
    pushJobEvent('submitted', currentJob);
    if (isTerminalScenarioJobStatus(currentJob.status)) {
      await finalizeAsyncVideoJob({ jobId: input.jobId, requestParams: input.requestParams, routeInfo: input.routeInfo, job: currentJob, elapsed: Date.now() - startedAt });
      return;
    }
    const stream = await modClient.media.jobs.subscribe(input.jobId);
    for await (const event of stream) {
      if (watchToken !== watchSequenceRef.current) return;
      currentJob = (event.job as unknown as Record<string, unknown>) || currentJob;
      pushJobEvent(scenarioJobEventLabel(event.eventType), currentJob, event.sequence);
      if (isTerminalScenarioJobStatus(currentJob.status)) {
        await finalizeAsyncVideoJob({ jobId: input.jobId, requestParams: input.requestParams, routeInfo: input.routeInfo, job: currentJob, elapsed: Date.now() - startedAt });
        return;
      }
    }
    if (watchToken !== watchSequenceRef.current) return;
    currentJob = await modClient.media.jobs.get(input.jobId) as unknown as Record<string, unknown>;
    await finalizeAsyncVideoJob({ jobId: input.jobId, requestParams: input.requestParams, routeInfo: input.routeInfo, job: currentJob, elapsed: Date.now() - startedAt });
  }, [finalizeAsyncVideoJob, onStateChange]);

  const handleJobSubmit = React.useCallback(async () => {
    if (!asString(prompt)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.videoGenerate.promptEmpty') }));
      return;
    }
    if (isI2v && !asString(refImageUri)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.videoGenerate.referenceRequired') }));
      return;
    }
    onStateChange((prev) => ({ ...prev, busy: true, error: '', diagnostics: makeEmptyDiagnostics() }));
    const binding = resolveEffectiveBinding(state.snapshot, props.binding ?? state.binding) || undefined;
    const contentItems = buildVideoContentItems();
    const options = buildVideoOptions();
    const requestParams: Record<string, unknown> = {
      mode: resolvedMode,
      prompt,
      options,
      content: contentItems,
      ...(binding ? { binding } : {}),
    };
    try {
      const routeInfo = bindingToRouteInfo(binding);
      const modClient = createModRuntimeClient('core:runtime');
      const job = await modClient.media.jobs.submit({
        modal: 'video',
        input: {
          mode: resolvedMode,
          content: contentItems,
          prompt,
          options,
          binding,
        } as unknown as ModRuntimeBoundVideoGenerateInput,
      });
      await watchAsyncVideoJob({
        jobId: asString((job as unknown as Record<string, unknown>)?.jobId),
        requestParams,
        routeInfo,
        initialJob: job as unknown as Record<string, unknown>,
      });
    } catch (error) {
      const baseMessage = error instanceof Error ? error.message : String(error || t('Tester.videoGenerate.submitFailed'));
      const details = (error as Record<string, unknown>)?.details as Record<string, unknown> | undefined;
      const providerMessage = details?.provider_message as string | undefined;
      const message = providerMessage ? `${baseMessage} [provider: ${providerMessage}]` : baseMessage;
      const rawResponse = toPrettyJson({ request: requestParams, error: message, details, stage: 'submit' });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'failed',
        error: message,
        rawResponse,
        diagnostics: { requestParams, resolvedRoute: bindingToRouteInfo(binding), responseMetadata: {} },
      }));
      appendHistory({
        id: `vid-${Date.now().toString(36)}`,
        timestamp: Date.now(),
        mode: resolvedMode,
        prompt,
        negativePrompt,
        ratio: params.ratio,
        durationSec: params.durationSec,
        result: 'failed',
        error: message,
        videoUri: '',
        rawResponse,
      });
    }
  }, [appendHistory, buildVideoContentItems, buildVideoOptions, isI2v, negativePrompt, onStateChange, params.durationSec, params.ratio, prompt, props.binding, refImageUri, resolvedMode, state.binding, state.snapshot, t, watchAsyncVideoJob]);

  const handleSyncRun = React.useCallback(async () => {
    if (!asString(prompt)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.videoGenerate.promptEmpty') }));
      return;
    }
    if (isI2v && !asString(refImageUri)) {
      onStateChange((prev) => ({ ...prev, error: t('Tester.videoGenerate.referenceRequired') }));
      return;
    }
    onStateChange((prev) => ({ ...prev, busy: true, error: '', diagnostics: makeEmptyDiagnostics() }));
    const t0 = Date.now();
    const binding = resolveEffectiveBinding(state.snapshot, props.binding ?? state.binding) || undefined;
    const contentItems = buildVideoContentItems();
    const options = buildVideoOptions();
    const requestParams: Record<string, unknown> = {
      mode: resolvedMode,
      prompt,
      options,
      content: contentItems,
      ...(binding ? { binding } : {}),
    };
    try {
      const callParams = await resolveCallParams(binding);
      const routeInfo = bindingToRouteInfo(binding);
      const result = await getRuntimeClient().media.video.generate({
        model: callParams.model,
        route: callParams.route,
        connectorId: callParams.connectorId,
        mode: resolvedMode,
        content: contentItems,
        prompt,
        options,
        metadata: callParams.metadata,
      });
      const elapsed = Date.now() - t0;
      const firstVideo = (result.artifacts || []).find((a) => {
        const mime = asString(a.mimeType);
        return mime.startsWith('video/') || (!mime && asString(a.uri));
      });
      const playbackUri = firstVideo
        ? toArtifactPreviewUri({ uri: firstVideo.uri, bytes: firstVideo.bytes, mimeType: firstVideo.mimeType, defaultMimeType: 'video/mp4' })
        : '';
      const rawResponse = toPrettyJson({ request: requestParams, response: stripArtifacts(result) });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'passed',
        output: playbackUri || result,
        rawResponse,
        diagnostics: {
          requestParams,
          resolvedRoute: routeInfo,
          responseMetadata: {
            jobId: (result.job as unknown as Record<string, unknown>)?.jobId as string | undefined,
            artifactCount: result.artifacts?.length,
            traceId: result.trace?.traceId,
            modelResolved: result.trace?.modelResolved,
            elapsed,
          },
        },
      }));
      appendHistory({
        id: `vid-${Date.now().toString(36)}`,
        timestamp: Date.now(),
        mode: resolvedMode,
        prompt,
        negativePrompt,
        ratio: params.ratio,
        durationSec: params.durationSec,
        result: 'passed',
        videoUri: playbackUri,
        rawResponse,
        elapsed,
      });
    } catch (error) {
      const elapsed = Date.now() - t0;
      const baseMessage = error instanceof Error ? error.message : String(error || t('Tester.videoGenerate.failed'));
      const details = (error as Record<string, unknown>)?.details as Record<string, unknown> | undefined;
      const providerMessage = details?.provider_message as string | undefined;
      const message = providerMessage ? `${baseMessage} [provider: ${providerMessage}]` : baseMessage;
      const rawResponse = toPrettyJson({ request: requestParams, error: message, details });
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'failed',
        error: message,
        rawResponse,
        diagnostics: { requestParams, resolvedRoute: bindingToRouteInfo(binding), responseMetadata: { elapsed } },
      }));
      appendHistory({
        id: `vid-${Date.now().toString(36)}`,
        timestamp: Date.now(),
        mode: resolvedMode,
        prompt,
        negativePrompt,
        ratio: params.ratio,
        durationSec: params.durationSec,
        result: 'failed',
        error: message,
        videoUri: '',
        rawResponse,
      });
    }
  }, [appendHistory, buildVideoContentItems, buildVideoOptions, isI2v, negativePrompt, onStateChange, params.durationSec, params.ratio, prompt, props.binding, refImageUri, resolvedMode, state.binding, state.snapshot, t]);

  const canSubmit = !state.busy && Boolean(prompt.trim()) && (!isI2v || Boolean(refImageUri.trim()));
  const handleRun = mode === 'job' ? handleJobSubmit : handleSyncRun;

  const previewState: PreviewState = (() => {
    if (state.busy) {
      return { kind: 'busy', label: state.busyLabel || t('Tester.videoGenerate.generating', { defaultValue: 'Generating…' }) };
    }
    const lastRecord = history[0];
    if (state.error && (!lastRecord || lastRecord.result === 'failed')) {
      return { kind: 'failed', error: state.error, record: lastRecord };
    }
    if (lastRecord && lastRecord.result === 'passed' && lastRecord.videoUri) {
      return { kind: 'success', videoUri: lastRecord.videoUri, record: lastRecord };
    }
    const inlineUri = typeof state.output === 'string' ? state.output : '';
    if (inlineUri && lastRecord) {
      return { kind: 'success', videoUri: inlineUri, record: lastRecord };
    }
    return { kind: 'empty' };
  })();

  const handleCopyPrompt = React.useCallback(() => {
    if (previewState.kind !== 'success') return;
    const target = previewState.record.prompt;
    if (!target) return;
    void navigator.clipboard?.writeText(target).catch(() => {});
  }, [previewState]);

  const handleRetry = React.useCallback(() => { void handleRun(); }, [handleRun]);

  const handleUploadError = React.useCallback((message: string) => {
    onStateChange((prev) => ({ ...prev, error: message }));
  }, [onStateChange]);

  return (
    <div className="flex flex-col gap-5">
      {/* CREATION CARD — same structure as Image page */}
      <div className="flex flex-col rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 pb-2 pt-3 transition-colors">
        <div className="flex items-start gap-3">
          {isI2v ? (
            <CompactUploadTile
              value={refImageUri}
              onChange={setRefImageUri}
              onError={handleUploadError}
            />
          ) : null}
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value.slice(0, PROMPT_MAX))}
            placeholder={t('Tester.videoGenerate.promptPlaceholder', { defaultValue: 'Describe your video...' })}
            rows={5}
            className="w-full resize-none border-0 bg-transparent px-0 py-0 text-sm leading-relaxed text-[var(--nimi-text-primary)] outline-none placeholder:text-[var(--nimi-text-muted)]"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSubmit) {
                event.preventDefault();
                void handleRun();
              }
            }}
          />
        </div>

        <div className="mt-2 border-t border-dashed border-[var(--nimi-border-subtle)] pt-2">
          <textarea
            value={negativePrompt}
            onChange={(event) => setNegativePrompt(event.target.value)}
            placeholder={t('Tester.videoGenerate.negativePromptPlaceholder', { defaultValue: 'Negative prompt (optional)...' })}
            rows={3}
            className="w-full resize-none border-0 bg-transparent px-0 py-0 text-xs leading-relaxed text-[var(--nimi-text-primary)] outline-none placeholder:text-[var(--nimi-text-muted)]"
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <ModeChip value={currentTab} onChange={handleModeChange} />
          <RatioResolutionChip
            ratio={params.ratio}
            resolution={params.resolution}
            onRatioChange={(v) => onParamsChange({ ...params, ratio: v })}
            onResolutionChange={(v) => onParamsChange({ ...params, resolution: v })}
          />
          <DurationChip
            value={params.durationSec}
            onChange={(v) => onParamsChange({ ...params, durationSec: v })}
          />
          <ToggleChip
            icon={SOUND_ICON}
            label={t('Tester.videoGenerate.audio', { defaultValue: 'Sound' })}
            active={params.generateAudio}
            onChange={(next) => onParamsChange({ ...params, generateAudio: next })}
          />
          <ToggleChip
            icon={LOCK_ICON}
            label={t('Tester.videoGenerate.cameraFixed', { defaultValue: 'Lock camera' })}
            active={params.cameraFixed}
            onChange={(next) => onParamsChange({ ...params, cameraFixed: next })}
          />

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] tabular-nums text-[var(--nimi-text-muted)]">
              {prompt.length}/{PROMPT_MAX}
            </span>
            <button
              type="button"
              onClick={() => { void handleRun(); }}
              disabled={!canSubmit}
              aria-label={mode === 'job'
                ? t('Tester.videoGenerate.submitJob', { defaultValue: 'Submit Video Job' })
                : t('Tester.videoGenerate.run', { defaultValue: 'Generate Video' })}
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

      {state.error && !state.busy ? <ErrorBox message={state.error} /> : null}

      {/* Subtle tertiary actions */}
      {mode === 'job' ? (
        <div className="-mt-2 flex items-center gap-3 px-1">
          <WatchJobLink
            busy={state.busy}
            onWatch={(jobId) => {
              void watchAsyncVideoJob({
                jobId,
                requestParams: { jobId, mode: 'attach' },
                routeInfo: null,
              });
            }}
          />
          {state.busy && state.busyLabel ? (
            <span className="text-[11px] text-[var(--nimi-text-muted)]">{state.busyLabel}</span>
          ) : null}
        </div>
      ) : null}

      <PreviewPanel
        state={previewState}
        ratio={params.ratio}
        onCopyPrompt={handleCopyPrompt}
        onRetry={handleRetry}
      />

      <HistoryGallery
        records={history}
        busy={state.busy}
        busyLabel={state.busyLabel || ''}
        onDelete={deleteHistoryRecord}
        onClear={clearHistory}
      />

      {jobTimeline.length > 0 ? (
        <div className="rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-canvas)] p-2 text-xs">
          <div className="mb-1 font-semibold text-[var(--nimi-text-secondary)]">
            {t('Tester.videoGenerate.jobTimeline', { defaultValue: 'Job Timeline' })}
          </div>
          {jobTimeline.map((event, i) => (
            <div key={i} className="text-[var(--nimi-text-primary)]">
              {`[${event.sequence}] ${event.label}: ${event.status}${asString(event.progressLabel) ? ` · ${asString(event.progressLabel)}` : ''}${asString(event.reasonDetail) ? ` — ${asString(event.reasonDetail)}` : ''}`}
            </div>
          ))}
        </div>
      ) : null}

      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
