import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, SelectField, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import type { CapabilityState } from '../tester-types.js';
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
import { DiagnosticsPanel, ErrorBox, RawJsonSection, RunButton } from '../tester-diagnostics.js';
import { createModRuntimeClient, type ModRuntimeBoundVideoGenerateInput } from '@nimiplatform/sdk/mod';

type VideoGeneratePanelProps = {
  mode: 'generate' | 'job';
  state: CapabilityState;
  binding?: CapabilityState['binding'];
  params: VideoParamsState;
  onParamsChange: (next: VideoParamsState) => void;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

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

function VideoPlayer({ src }: { src: string }) {
  if (!src) return null;
  return (
    <div className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] overflow-hidden bg-black">
      <video
        src={src}
        controls
        autoPlay
        loop
        playsInline
        className="block w-full max-h-[480px] object-contain"
      />
    </div>
  );
}

export function VideoGeneratePanel(props: VideoGeneratePanelProps) {
  const { t } = useTranslation();
  const { mode, onParamsChange, params, state, onStateChange } = props;
  const [prompt, setPrompt] = React.useState('A serene mountain landscape with flowing clouds.');
  const [refImageUri, setRefImageUri] = React.useState('');
  const [watchJobId, setWatchJobId] = React.useState('');
  const [jobTimeline, setJobTimeline] = React.useState<Array<Record<string, unknown>>>([]);
  const watchSequenceRef = React.useRef(0);
  const [videoUri, setVideoUri] = React.useState('');
  const isI2v = params.mode !== 't2v';

  const resolvedMode = params.mode as 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference';

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
  }), [params]);

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

    // Resolve the first video artifact URI for playback
    const firstVideoArtifact = (artifactsResponse.artifacts || []).find((a) => {
      const mime = asString(a.mimeType);
      return mime.startsWith('video/') || (!mime && asString(a.uri));
    });
    const playbackUri = firstVideoArtifact
      ? toArtifactPreviewUri({ uri: firstVideoArtifact.uri, bytes: firstVideoArtifact.bytes, mimeType: firstVideoArtifact.mimeType, defaultMimeType: 'video/mp4' })
      : '';
    setVideoUri(playbackUri);

    const jobRecord = input.job || {};
    // If the job completed but no playable video URI was resolved, treat it
    // as a playback-stage failure so the tester never shows a false positive.
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
  }, [jobTimeline, onStateChange]);

  const watchAsyncVideoJob = React.useCallback(async (input: {
    jobId: string;
    requestParams: Record<string, unknown> | null;
    routeInfo: Record<string, unknown> | null;
    initialJob?: Record<string, unknown> | null;
  }) => {
    const watchToken = ++watchSequenceRef.current;
    const startedAt = Date.now();
    setWatchJobId(input.jobId);
    setJobTimeline([]);
    setVideoUri('');
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
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'failed',
        error: message,
        rawResponse: toPrettyJson({ request: requestParams, error: message, details, stage: 'submit' }),
        diagnostics: { requestParams, resolvedRoute: bindingToRouteInfo(binding), responseMetadata: {} },
      }));
    }
  }, [buildVideoContentItems, buildVideoOptions, isI2v, onStateChange, prompt, props.binding, refImageUri, resolvedMode, state.binding, state.snapshot, t, watchAsyncVideoJob]);

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
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'passed',
        output: result,
        rawResponse: toPrettyJson({ request: requestParams, response: stripArtifacts(result) }),
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
    } catch (error) {
      const elapsed = Date.now() - t0;
      const baseMessage = error instanceof Error ? error.message : String(error || t('Tester.videoGenerate.failed'));
      const details = (error as Record<string, unknown>)?.details as Record<string, unknown> | undefined;
      const providerMessage = details?.provider_message as string | undefined;
      const message = providerMessage ? `${baseMessage} [provider: ${providerMessage}]` : baseMessage;
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'failed',
        error: message,
        rawResponse: toPrettyJson({ request: requestParams, error: message, details }),
        diagnostics: { requestParams, resolvedRoute: bindingToRouteInfo(binding), responseMetadata: { elapsed } },
      }));
    }
  }, [buildVideoContentItems, buildVideoOptions, isI2v, onStateChange, prompt, props.binding, refImageUri, resolvedMode, state.binding, state.snapshot, t]);

  const modeOptions = [
    { value: 't2v', label: t('Tester.videoGenerate.t2v') },
    { value: 'i2v-first-frame', label: t('Tester.videoGenerate.i2vFirstFrame') },
    { value: 'i2v-reference', label: t('Tester.videoGenerate.i2vReference') },
  ];

  const ratioOptions = [
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
    { value: '1:1', label: '1:1' },
    { value: '4:3', label: '4:3' },
    { value: '3:4', label: '3:4' },
    { value: '21:9', label: '21:9' },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--nimi-text-muted)]">{t('Tester.videoGenerate.mode')}</span>
        <SelectField options={modeOptions} value={params.mode} onValueChange={(value) => onParamsChange({ ...params, mode: value })} />
      </div>
      <TextareaField className="font-mono text-xs" textareaClassName="h-20" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t('Tester.videoGenerate.promptPlaceholder')} />
      {isI2v ? (
        <TextField className="font-mono text-xs" value={refImageUri} onChange={(event) => setRefImageUri(event.target.value)} placeholder={t('Tester.videoGenerate.refImagePlaceholder')} />
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--nimi-text-muted)]">{t('Tester.videoGenerate.ratio')}</span>
          <SelectField options={ratioOptions} value={params.ratio} onValueChange={(value) => onParamsChange({ ...params, ratio: value })} />
        </div>
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--nimi-text-muted)]">{t('Tester.videoGenerate.duration')}</span>
          <TextField type="number" min={1} max={11} value={params.durationSec} onChange={(event) => onParamsChange({ ...params, durationSec: event.target.value || '5' })} />
        </div>
        <label className="flex items-center gap-1.5 text-xs pt-4">
          <input type="checkbox" checked={params.generateAudio} onChange={(event) => onParamsChange({ ...params, generateAudio: event.target.checked })} />
          <span className="text-[var(--nimi-text-muted)]">{t('Tester.videoGenerate.audio')}</span>
        </label>
      </div>

      {mode === 'job' ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <TextField
              className="flex-1 font-mono text-xs"
              value={watchJobId}
              onChange={(event) => setWatchJobId(event.target.value)}
              placeholder={t('Tester.videoGenerate.jobIdPlaceholder', { defaultValue: 'Job ID to watch...' })}
            />
            <Button
              tone="secondary"
              size="sm"
              disabled={state.busy}
              onClick={() => {
                const trimmedJobId = asString(watchJobId);
                if (!trimmedJobId) {
                  onStateChange((prev) => ({ ...prev, error: 'Job ID is required to watch.' }));
                  return;
                }
                void watchAsyncVideoJob({
                  jobId: trimmedJobId,
                  requestParams: { jobId: trimmedJobId, mode: 'attach' },
                  routeInfo: null,
                });
              }}
            >
              {t('Tester.videoGenerate.watch', { defaultValue: 'Watch' })}
            </Button>
          </div>
          <RunButton
            busy={state.busy}
            busyLabel={state.busyLabel}
            label={t('Tester.videoGenerate.submitJob', { defaultValue: 'Submit Video Job' })}
            onClick={() => { void handleJobSubmit(); }}
          />
          {jobTimeline.length > 0 ? (
            <div className="rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-canvas)] p-2 text-xs">
              <div className="font-semibold text-[var(--nimi-text-secondary)] mb-1">
                {t('Tester.videoGenerate.jobTimeline', { defaultValue: 'Job Timeline' })}
              </div>
              {jobTimeline.map((event, i) => (
                <div key={i} className="text-[var(--nimi-text-primary)]">
                  {`[${event.sequence}] ${event.label}: ${event.status}${asString(event.progressLabel) ? ` · ${asString(event.progressLabel)}` : ''}${asString(event.reasonDetail) ? ` — ${asString(event.reasonDetail)}` : ''}`}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <RunButton busy={state.busy} label={t('Tester.videoGenerate.run')} onClick={() => { void handleSyncRun(); }} />
      )}

      {state.error ? <ErrorBox message={state.error} /> : null}
      {mode === 'job' && videoUri ? <VideoPlayer src={videoUri} /> : null}
      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
