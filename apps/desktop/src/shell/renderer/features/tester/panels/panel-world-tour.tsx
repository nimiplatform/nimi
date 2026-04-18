import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, SelectField, Surface, TextareaField, TextField } from '@nimiplatform/nimi-kit/ui';
import { createModRuntimeClient } from '@nimiplatform/sdk/mod';
import {
  createInspectWorldRenderPlan,
  createInspectWorldSession,
  generate as worldGenerate,
  type WorldFixturePackage,
  type WorldInspectRenderPlan,
  type WorldInspectSession,
} from '@nimiplatform/sdk/world';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { hasTauriRuntime, invokeTauri } from '@runtime/tauri-api';
import type { CapabilityState } from '../tester-types.js';
import {
  asString,
  buildAsyncImageJobOutcome,
  isTerminalScenarioJobStatus,
  scenarioJobEventLabel,
  scenarioJobStatusLabel,
  stripArtifacts,
  toPrettyJson,
} from '../tester-utils.js';
import { resolveEffectiveBinding } from '../tester-route.js';
import { makeEmptyDiagnostics } from '../tester-state.js';
import { bindingToRouteInfo } from '../tester-runtime.js';
import { DiagnosticsPanel, ErrorBox, InfoBox, RawJsonSection, RunButton } from '../tester-diagnostics.js';
import {
  normalizeWorldGenerateOutput,
  resolveWorldTourAssetUrl,
  type ResolvedWorldTourFixture,
  WORLD_TOUR_CACHE_MANIFEST_PATH,
  worldTourFixtureToWorldResult,
  type WorldResultRecord,
} from '../world-tour-shared';

type WorldTourPanelProps = {
  state: CapabilityState;
  onStateChange: (updater: (prev: CapabilityState) => CapabilityState) => void;
};

function currentRouteStatusMessage(binding: CapabilityState['binding']): string {
  if (!binding) {
    return 'Select a cloud route for world.generate first.';
  }
  if (binding.source !== 'cloud') {
    return 'world.generate is cloud-first in the first wave. Select a cloud connector.';
  }
  if ((binding.provider || '').trim().toLowerCase() !== 'worldlabs') {
    return 'The route is valid, but first-wave product acceptance is currently defined against the worldlabs provider.';
  }
  return 'Cloud route is ready for the World Labs first-wave execution chain.';
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

function extractWorldGenerateOutput(output: unknown): WorldResultRecord | null {
  if (!output || typeof output !== 'object') {
    return null;
  }
  const outputRecord = output as Record<string, unknown>;
  const payload = outputRecord.output;
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const payloadRecord = payload as Record<string, unknown>;
  if (payloadRecord.oneofKind !== 'worldGenerate') {
    return null;
  }
  return normalizeWorldGenerateOutput(payloadRecord.worldGenerate);
}

function openWorldTourWindowFallback(manifestPath: string): void {
  const base = `${window.location.origin}${window.location.pathname}`;
  const query = new URLSearchParams({ manifestPath }).toString();
  const href = `${base}#/world-tour-viewer?${query}`;
  window.open(href, '_blank', 'noopener,noreferrer,width=1440,height=920');
}

function WorldResultSummary(props: {
  world: WorldFixturePackage;
  renderPlan: WorldInspectRenderPlan | null;
  sessionState: WorldInspectSession | null;
  fixture: ResolvedWorldTourFixture | null;
  launchBusy: boolean;
  launchStatus: string;
  launchError: string;
  onLaunch: () => void;
}) {
  const { t } = useTranslation();
  const previewImage = resolveWorldTourAssetUrl(
    props.renderPlan?.previewImageLocalPath || props.fixture?.thumbnailLocalPath || props.world.thumbnailLocalPath,
    props.renderPlan?.previewImageUrl || props.fixture?.thumbnailRemoteUrl || props.world.thumbnailUrl || props.world.panoUrl,
  );
  const semantics = props.world.semanticsMetadata;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-[var(--nimi-text-secondary)]">
          {t('Tester.worldTour.launchOnlyNotice', {
            defaultValue: 'Tester is now launch-only for world browsing. Heavy Spark lifecycle moved into the dedicated desktop world-tour window.',
          })}
        </div>
        <Button
          data-testid={E2E_IDS.worldTourLaunchButton}
          tone="secondary"
          size="sm"
          disabled={!props.fixture || props.launchBusy}
          onClick={props.onLaunch}
        >
          {props.launchBusy
            ? t('Tester.worldTour.launching', { defaultValue: 'Launching...' })
            : t('Tester.worldTour.launchButton', { defaultValue: 'Launch World Tour' })}
        </Button>
      </div>
      {props.launchStatus ? <InfoBox message={props.launchStatus} /> : null}
      {props.launchError ? <ErrorBox message={props.launchError} /> : null}

      {previewImage ? (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-[var(--nimi-text-secondary)]">
            {t('Tester.worldTour.fixtureImagery', { defaultValue: 'Fixture imagery' })}
          </div>
          <div className="overflow-hidden rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]">
            <img
              src={previewImage}
              alt={t('Tester.worldTour.worldPreviewAlt', { defaultValue: 'World preview' })}
              className="block max-h-[320px] w-full object-cover"
            />
          </div>
        </div>
      ) : null}

      <Surface tone="card" padding="sm" className="flex flex-col gap-1 text-xs text-[var(--nimi-text-secondary)]">
        <div className="font-semibold text-[var(--nimi-text-primary)]">
          {t('Tester.worldTour.worldResult', { defaultValue: 'World result' })}
        </div>
        {props.world.worldId ? (
          <div>
            {t('Tester.worldTour.worldIdLabel', { defaultValue: 'world id:' })}{' '}
            <span className="font-mono text-[var(--nimi-text-primary)]">{props.world.worldId}</span>
          </div>
        ) : null}
        {props.world.model ? (
          <div>
            {t('Tester.worldTour.modelLabel', { defaultValue: 'model:' })}{' '}
            <span className="font-mono text-[var(--nimi-text-primary)]">{props.world.model}</span>
          </div>
        ) : null}
        {props.world.caption ? (
          <div>
            {t('Tester.worldTour.captionLabel', { defaultValue: 'caption:' })}{' '}
            <span className="text-[var(--nimi-text-primary)]">{props.world.caption}</span>
          </div>
        ) : null}
        {semantics ? (
          <div>
            {t('Tester.worldTour.semanticsLabel', { defaultValue: 'semantics:' })}{' '}
            <span className="font-mono text-[var(--nimi-text-primary)]">
              offset={Number.isFinite(semantics.groundPlaneOffset) ? semantics.groundPlaneOffset : 0}
              {' · '}
              scale={Number.isFinite(semantics.metricScaleFactor) ? semantics.metricScaleFactor : 0}
            </span>
          </div>
        ) : null}
        {props.renderPlan ? (
          <div>
            {t('Tester.worldTour.renderPlanLabel', { defaultValue: 'render plan:' })}{' '}
            <span className="font-mono text-[var(--nimi-text-primary)]">
              {props.renderPlan.mode}
              {' · '}
              camera={props.renderPlan.initialCameraPolicy.source}
              {' · '}
              spz={props.renderPlan.capabilityRequirements.requiresSpzAsset ? 'required' : 'optional'}
            </span>
          </div>
        ) : null}
        {props.sessionState ? (
          <div>
            {t('Tester.worldTour.sessionLabel', { defaultValue: 'session:' })}{' '}
            <span className="font-mono text-[var(--nimi-text-primary)]">
              {props.sessionState.sessionId}
              {' · '}
              {props.sessionState.lifecycle}
            </span>
          </div>
        ) : null}
      </Surface>

      <Surface tone="card" padding="sm" className="flex flex-col gap-1 text-xs text-[var(--nimi-text-secondary)]">
        <div className="font-semibold text-[var(--nimi-text-primary)]">
          {t('Tester.worldTour.viewerLaunchContract', { defaultValue: 'Viewer launch contract' })}
        </div>
        {props.fixture?.manifestPath ? (
          <div>
            {t('Tester.worldTour.manifestPathLabel', { defaultValue: 'manifest path:' })}{' '}
            <span className="font-mono break-all text-[var(--nimi-text-primary)]">{props.fixture.manifestPath}</span>
          </div>
        ) : null}
        {props.fixture?.spzLocalPath ? (
          <div>
            {t('Tester.worldTour.spzLocalPathLabel', { defaultValue: 'SPZ local path:' })}{' '}
            <span className="font-mono break-all text-[var(--nimi-text-primary)]">{props.fixture.spzLocalPath}</span>
          </div>
        ) : null}
        {props.fixture?.colliderMeshLocalPath ? (
          <div>
            {t('Tester.worldTour.colliderLocalPathLabel', { defaultValue: 'Collider local path:' })}{' '}
            <span className="font-mono break-all text-[var(--nimi-text-primary)]">{props.fixture.colliderMeshLocalPath}</span>
          </div>
        ) : null}
        {props.fixture ? (
          <div>
            {t('Tester.worldTour.assetDeliveryNotice', {
              defaultValue: 'asset delivery: canonical local paths resolved by Tauri, loaded directly through asset protocol',
            })}
          </div>
        ) : (
          <div>
            {t('Tester.worldTour.fixtureRequiredNotice', {
              defaultValue: 'Launch requires a resolved fixture manifest.',
            })}
          </div>
        )}
      </Surface>

      <Surface tone="card" padding="sm" className="flex flex-col gap-1 text-xs text-[var(--nimi-text-secondary)]">
        <div className="font-semibold text-[var(--nimi-text-primary)]">
          {t('Tester.worldTour.assetEndpoints', { defaultValue: 'Asset endpoints' })}
        </div>
        {Object.entries(props.world.spzUrls || {}).map(([key, url]) => (
          <div key={key} className="break-all">
            <span className="font-mono text-[var(--nimi-text-primary)]">{key}</span>: {url}
          </div>
        ))}
        {props.world.worldMarbleUrl ? (
          <div className="break-all">
            {t('Tester.worldTour.viewerHandoffLabel', { defaultValue: 'viewer handoff:' })} {props.world.worldMarbleUrl}
          </div>
        ) : null}
        {props.world.colliderMeshUrl ? (
          <div className="break-all">
            {t('Tester.worldTour.colliderMeshLabel', { defaultValue: 'collider mesh:' })} {props.world.colliderMeshUrl}
          </div>
        ) : null}
      </Surface>
    </div>
  );
}

export function WorldTourPanel(props: WorldTourPanelProps) {
  const { t } = useTranslation();
  const { state, onStateChange } = props;
  const [textPrompt, setTextPrompt] = React.useState('A walkable waterfront district with layered architecture, bridges, and soft afternoon light.');
  const [displayName, setDisplayName] = React.useState('World Tour Preview');
  const [referenceImageUrl, setReferenceImageUrl] = React.useState('');
  const [seed, setSeed] = React.useState('');
  const [tagsText, setTagsText] = React.useState('world-tour,preview');
  const [model, setModel] = React.useState('marble-1.1');
  const [watchJobId, setWatchJobId] = React.useState('');
  const [jobTimeline, setJobTimeline] = React.useState<Array<Record<string, unknown>>>([]);
  const [launchableFixture, setLaunchableFixture] = React.useState<ResolvedWorldTourFixture | null>(null);
  const [launchBusy, setLaunchBusy] = React.useState(false);
  const [launchStatus, setLaunchStatus] = React.useState('');
  const [launchError, setLaunchError] = React.useState('');
  const watchSequenceRef = React.useRef(0);

  const effectiveBinding = resolveEffectiveBinding(state.snapshot, state.binding);
  const routeStatus = currentRouteStatusMessage(effectiveBinding);
  const worldOutput = normalizeWorldGenerateOutput(state.output);
  const renderPlan = React.useMemo(
    () => createInspectWorldRenderPlan(worldOutput),
    [worldOutput],
  );
  const sessionState = React.useMemo(
    () => createInspectWorldSession({
      fixture: worldOutput,
      renderPlan,
    }),
    [worldOutput, renderPlan],
  );

  const finalizeWorldJob = React.useCallback(async (input: {
    jobId: string;
    requestParams: Record<string, unknown> | null;
    routeInfo: Record<string, unknown> | null;
    job?: Record<string, unknown> | null;
    elapsed: number;
  }) => {
    let artifactFetchError = '';
    let artifactsResponse: {
      artifacts: Array<Record<string, unknown>>;
      traceId?: string;
      output?: unknown;
    } = { artifacts: [] };
    try {
      const modClient = createModRuntimeClient('core:runtime');
      const response = await modClient.media.jobs.getArtifacts(input.jobId) as unknown as {
        artifacts?: Array<Record<string, unknown>>;
        traceId?: string;
        output?: unknown;
      };
      artifactsResponse = {
        artifacts: Array.isArray(response.artifacts) ? response.artifacts : [],
        traceId: asString(response.traceId) || undefined,
        output: response.output,
      };
    } catch (error) {
      artifactFetchError = error instanceof Error ? error.message : String(error || 'Failed to fetch world job artifacts.');
    }

    const jobRecord = input.job || {};
    const world = extractWorldGenerateOutput(artifactsResponse.output);
    const playbackError = !artifactFetchError && !world
      ? 'Job finished but no world.generate typed output was returned.'
      : '';
    const combinedArtifactError = [artifactFetchError, playbackError].filter(Boolean).join(' | ');
    const outcome = buildAsyncImageJobOutcome({
      status: jobRecord.status,
      reasonDetail: jobRecord.reasonDetail,
      artifactFetchError: combinedArtifactError,
    });
    const rawResponse = toPrettyJson({
      request: input.requestParams,
      jobId: input.jobId,
      job: input.job,
      events: jobTimeline,
      artifacts: stripArtifacts({ artifacts: artifactsResponse.artifacts }),
      output: world,
    });
    setLaunchableFixture(null);
    setLaunchStatus('');
    setLaunchError('');
    onStateChange((prev) => ({
      ...prev,
      busy: false,
      busyLabel: '',
      result: outcome.result,
      error: outcome.error,
      output: world,
      rawResponse,
      diagnostics: {
        requestParams: input.requestParams,
        resolvedRoute: input.routeInfo as any,
        responseMetadata: {
          jobId: input.jobId,
          artifactCount: artifactsResponse.artifacts.length,
          traceId: asString(jobRecord.traceId || artifactsResponse.traceId) || undefined,
          elapsed: input.elapsed,
          modelResolved: world?.model,
          finishReason: outcome.terminalStatus,
        },
      },
    }));
  }, [jobTimeline, onStateChange]);

  const handleLoadCachedFixture = React.useCallback(async () => {
    onStateChange((prev) => ({ ...prev, busy: true, busyLabel: 'Resolving cached fixture...', error: '' }));
    setLaunchBusy(false);
    setLaunchStatus('');
    setLaunchError('');
    try {
      const fixture = await invokeTauri<ResolvedWorldTourFixture>('resolve_world_tour_fixture', {
        payload: { manifestPath: WORLD_TOUR_CACHE_MANIFEST_PATH },
      });
      const world = worldTourFixtureToWorldResult(fixture);
      setLaunchableFixture(fixture);
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        busyLabel: '',
        result: 'passed',
        error: '',
        output: world,
        rawResponse: toPrettyJson({ source: 'cached-fixture', fixture }),
        diagnostics: {
          requestParams: { source: 'cached-fixture', manifestPath: fixture.manifestPath },
          resolvedRoute: bindingToRouteInfo(effectiveBinding),
          responseMetadata: {
            finishReason: 'cached-fixture',
          },
        },
      }));
    } catch (error) {
      setLaunchableFixture(null);
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        busyLabel: '',
        result: 'failed',
        error: error instanceof Error ? error.message : String(error || 'Failed to load cached fixture.'),
      }));
    }
  }, [effectiveBinding, onStateChange]);

  const watchAsyncWorldJob = React.useCallback(async (input: {
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
        busyLabel: progressLabel ? `Watching world job... ${progressLabel}` : 'Watching world job...',
      }));
    };

    setLaunchableFixture(null);
    setLaunchStatus('');
    setLaunchError('');
    onStateChange((prev) => ({
      ...prev,
      busy: true,
      busyLabel: 'Watching world job...',
      error: '',
      output: null,
      diagnostics: {
        requestParams: input.requestParams,
        resolvedRoute: input.routeInfo as any,
        responseMetadata: { jobId: input.jobId },
      },
    }));

    const modClient = createModRuntimeClient('core:runtime');
    let currentJob = input.initialJob || await modClient.media.jobs.get(input.jobId) as unknown as Record<string, unknown>;
    if (watchToken !== watchSequenceRef.current) return;
    pushJobEvent('submitted', currentJob);

    if (isTerminalScenarioJobStatus(currentJob.status)) {
      await finalizeWorldJob({
        jobId: input.jobId,
        requestParams: input.requestParams,
        routeInfo: input.routeInfo,
        job: currentJob,
        elapsed: Date.now() - startedAt,
      });
      return;
    }

    const stream = await modClient.media.jobs.subscribe(input.jobId);
    for await (const event of stream) {
      if (watchToken !== watchSequenceRef.current) return;
      currentJob = (event.job as unknown as Record<string, unknown>) || currentJob;
      pushJobEvent(scenarioJobEventLabel(event.eventType), currentJob, event.sequence);
      if (isTerminalScenarioJobStatus(currentJob.status)) {
        await finalizeWorldJob({
          jobId: input.jobId,
          requestParams: input.requestParams,
          routeInfo: input.routeInfo,
          job: currentJob,
          elapsed: Date.now() - startedAt,
        });
        return;
      }
    }

    if (watchToken !== watchSequenceRef.current) return;
    currentJob = await modClient.media.jobs.get(input.jobId) as unknown as Record<string, unknown>;
    await finalizeWorldJob({
      jobId: input.jobId,
      requestParams: input.requestParams,
      routeInfo: input.routeInfo,
      job: currentJob,
      elapsed: Date.now() - startedAt,
    });
  }, [finalizeWorldJob, onStateChange]);

  const handleJobSubmit = React.useCallback(async () => {
    if (!asString(textPrompt) && !asString(referenceImageUrl)) {
      onStateChange((prev) => ({
        ...prev,
        error: 'Provide a text prompt or at least one reference image URL.',
      }));
      return;
    }

    onStateChange((prev) => ({ ...prev, busy: true, error: '', diagnostics: makeEmptyDiagnostics() }));
    const binding = resolveEffectiveBinding(state.snapshot, state.binding) || undefined;
    const routeInfo = bindingToRouteInfo(binding);
    const tags = tagsText.split(',').map((value) => value.trim()).filter(Boolean);
    const conditioning = asString(referenceImageUrl)
      ? {
        type: 'image' as const,
        content: {
          kind: 'uri' as const,
          uri: referenceImageUrl,
        },
      }
      : undefined;

    try {
      const projection = worldGenerate.project({
        displayName: asString(displayName) || undefined,
        textPrompt: asString(textPrompt) || undefined,
        tags,
        seed: seed ? Number(seed) : undefined,
        conditioning,
      });
      const runtimeInput = worldGenerate.toRuntimeInput(projection, {
        model,
      });
      const requestParams: Record<string, unknown> = {
        projection,
        runtimeInput,
        ...(binding ? { binding } : {}),
      };
      const modClient = createModRuntimeClient('core:runtime');
      const job = await modClient.media.world.generate({
        ...runtimeInput,
        binding,
      });
      await watchAsyncWorldJob({
        jobId: asString((job as unknown as Record<string, unknown>)?.jobId),
        requestParams,
        routeInfo,
        initialJob: job as unknown as Record<string, unknown>,
      });
    } catch (error) {
      const baseMessage = error instanceof Error ? error.message : String(error || 'Failed to submit world.generate job.');
      const details = (error as Record<string, unknown>)?.details as Record<string, unknown> | undefined;
      const providerMessage = details?.provider_message as string | undefined;
      const message = providerMessage ? `${baseMessage} [provider: ${providerMessage}]` : baseMessage;
      onStateChange((prev) => ({
        ...prev,
        busy: false,
        result: 'failed',
        error: message,
        rawResponse: toPrettyJson({ error: message, details, stage: 'submit' }),
        diagnostics: {
          requestParams: null,
          resolvedRoute: routeInfo,
          responseMetadata: {},
        },
      }));
    }
  }, [displayName, model, onStateChange, referenceImageUrl, seed, state.binding, state.snapshot, tagsText, textPrompt, watchAsyncWorldJob]);

  const handleLaunchWorldTour = React.useCallback(async () => {
    if (!launchableFixture?.manifestPath) {
      setLaunchError('Launch requires a resolved cached fixture manifest.');
      return;
    }
    setLaunchBusy(true);
    setLaunchError('');
    setLaunchStatus('');
    try {
      if (hasTauriRuntime()) {
        const response = await invokeTauri<{ windowLabel: string; manifestPath: string }>('open_world_tour_window', {
          payload: { manifestPath: launchableFixture.manifestPath },
        });
        setLaunchStatus(`Opened dedicated world-tour window: ${response.windowLabel}`);
      } else {
        openWorldTourWindowFallback(launchableFixture.manifestPath);
        setLaunchStatus('Opened browser fallback world-tour window.');
      }
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : String(error || 'Failed to launch world-tour window.'));
    } finally {
      setLaunchBusy(false);
    }
  }, [launchableFixture]);

  const routeError = !effectiveBinding
    ? t('Tester.worldTour.routeMissing', { defaultValue: 'No world.generate route is selected yet.' })
    : effectiveBinding.source !== 'cloud'
      ? t('Tester.worldTour.cloudOnly', { defaultValue: 'First-wave world.generate must resolve to a cloud route.' })
      : '';

  return (
    <div data-testid={E2E_IDS.testerPanel('world.generate')} className="flex flex-col gap-3">
      <Surface tone="card" padding="sm" className="flex flex-col gap-2">
        <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('Tester.worldTour.title', { defaultValue: 'World Tour Acceptance Lane' })}
        </div>
        <div className="text-xs text-[var(--nimi-text-secondary)]">
          {t('Tester.worldTour.summary', {
            defaultValue: 'Tester now resolves fixtures and launches a dedicated desktop viewer window. Heavy Spark rendering no longer runs inside the tester panel.',
          })}
        </div>
        <div className="grid gap-1 text-xs text-[var(--nimi-text-secondary)]">
          <div>
            {t('Tester.worldTour.providerModelSummaryLabel', { defaultValue: 'provider model:' })}{' '}
            <code>marble-1.1</code> {t('Tester.worldTour.providerModelDefault', { defaultValue: 'default,' })}{' '}
            <code>marble-1.1-plus</code> {t('Tester.worldTour.providerModelOptional', { defaultValue: 'optional' })}
          </div>
          <div>
            {t('Tester.worldTour.assetStanceLabel', { defaultValue: 'asset stance:' })}{' '}
            <code>{t('Tester.worldTour.assetStanceValue', { defaultValue: 'SPZ-first' })}</code>
          </div>
          <div>
            {t('Tester.worldTour.viewerSurfaceLabel', { defaultValue: 'viewer surface:' })}{' '}
            <code>{t('Tester.worldTour.viewerSurfaceValue', { defaultValue: 'desktop world-tour window' })}</code>
          </div>
          <div>
            {t('Tester.worldTour.loadPathLabel', { defaultValue: 'load path:' })}{' '}
            <code>{t('Tester.worldTour.loadPathValue', {
              defaultValue: 'canonical local paths -> asset protocol -> Spark 2.0',
            })}</code>
          </div>
        </div>
      </Surface>

      {routeError ? <ErrorBox message={routeError} /> : <InfoBox message={routeStatus} />}

      <div className="grid gap-2 md:grid-cols-2">
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--nimi-text-muted)]">
            {t('Tester.worldTour.providerModelField', { defaultValue: 'Provider model' })}
          </span>
          <SelectField
            options={[
              { value: 'marble-1.1', label: 'marble-1.1' },
              { value: 'marble-1.1-plus', label: 'marble-1.1-plus' },
            ]}
            value={model}
            onValueChange={setModel}
          />
        </div>
        <TextField
          className="font-mono text-xs"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder={t('Tester.worldTour.displayNamePlaceholder', { defaultValue: 'Display name' })}
        />
      </div>

      <TextareaField
        data-testid={E2E_IDS.testerInput('world-generate-prompt')}
        className="font-mono text-xs"
        textareaClassName="h-24"
        value={textPrompt}
        onChange={(event) => setTextPrompt(event.target.value)}
        placeholder={t('Tester.worldTour.promptPlaceholder', {
          defaultValue: 'Describe the world to generate...',
        })}
      />

      <div className="grid gap-2 md:grid-cols-2">
        <TextField
          className="font-mono text-xs"
          value={referenceImageUrl}
          onChange={(event) => setReferenceImageUrl(event.target.value)}
          placeholder={t('Tester.worldTour.referenceImagePlaceholder', {
            defaultValue: 'Optional reference image URL',
          })}
        />
        <TextField
          className="font-mono text-xs"
          type="number"
          min={0}
          value={seed}
          onChange={(event) => setSeed(event.target.value)}
          placeholder={t('Tester.worldTour.seedPlaceholder', { defaultValue: 'Optional seed' })}
        />
      </div>

      <TextField
        className="font-mono text-xs"
        value={tagsText}
        onChange={(event) => setTagsText(event.target.value)}
        placeholder={t('Tester.worldTour.tagsPlaceholder', {
          defaultValue: 'Optional tags, comma separated',
        })}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <TextField
            className="flex-1 font-mono text-xs"
            value={watchJobId}
            onChange={(event) => setWatchJobId(event.target.value)}
            placeholder={t('Tester.worldTour.watchJobPlaceholder', {
              defaultValue: 'Existing job ID to watch...',
            })}
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
              void watchAsyncWorldJob({
                jobId: trimmedJobId,
                requestParams: { jobId: trimmedJobId, mode: 'attach' },
                routeInfo: bindingToRouteInfo(effectiveBinding),
              });
            }}
          >
            Watch
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <RunButton
            busy={state.busy}
            busyLabel={state.busyLabel}
            label={t('Tester.worldTour.run', { defaultValue: 'Run World Tour' })}
            onClick={() => { void handleJobSubmit(); }}
          />
          <Button
            tone="secondary"
            size="sm"
            disabled={state.busy}
            onClick={() => { void handleLoadCachedFixture(); }}
          >
            Load Cached Fixture
          </Button>
        </div>
      </div>

      {jobTimeline.length > 0 ? (
        <div className="rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-canvas)] p-2 text-xs">
          <div className="mb-1 font-semibold text-[var(--nimi-text-secondary)]">
            {t('Tester.worldTour.jobTimeline', { defaultValue: 'Job timeline' })}
          </div>
          {jobTimeline.map((event, index) => (
            <div key={index} className="text-[var(--nimi-text-primary)]">
              {`[${event.sequence}] ${event.label}: ${event.status}${asString(event.progressLabel) ? ` · ${asString(event.progressLabel)}` : ''}${asString(event.reasonDetail) ? ` — ${asString(event.reasonDetail)}` : ''}`}
            </div>
          ))}
        </div>
      ) : null}

      {state.error ? <ErrorBox message={state.error} /> : null}
      {worldOutput ? (
        <WorldResultSummary
          world={worldOutput}
          renderPlan={renderPlan}
          sessionState={sessionState}
          fixture={launchableFixture}
          launchBusy={launchBusy}
          launchStatus={launchStatus}
          launchError={launchError}
          onLaunch={handleLaunchWorldTour}
        />
      ) : null}

      <DiagnosticsPanel diagnostics={state.diagnostics} />
      {state.rawResponse ? <RawJsonSection content={state.rawResponse} /> : null}
    </div>
  );
}
